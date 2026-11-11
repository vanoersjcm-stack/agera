import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/authenticated-user.js';
import { AuditService } from '../core/audit/audit.service.js';
import { TenantContext } from '../core/tenancy/tenant-context.service.js';
import { TenantTransaction } from '../core/tenancy/tenant-transaction.service.js';
import { MailService, type MailStatus } from '../mail/mail.service.js';
import { type Audience, SurveysService } from '../surveys/surveys.service.js';
import { UserService } from '../user/user.service.js';

export interface MailMergeInput {
  audience: Audience;
  templateId: string;
  recipients: 'primary' | 'all';
}

export interface MergedMail {
  clientId: string;
  clientName: string;
  contactId: string;
  contactName: string;
  email: string;
  subject: string;
  text: string;
  missing: string[];
}

export interface MailMergePreview {
  template: { id: string; name: string };
  mails: MergedMail[];
  clientsWithoutEmail: { id: string; name: string }[];
  mail: MailStatus;
}

const MAX_MAILS = 2000;
const fullName = (first: string | null, last: string | null) => [first, last].filter((x) => x && x.trim()).join(' ');

/** Agera ManyMail: one personalised e-mail per contact of a client cohort, from a mail template. */
@Injectable()
export class MailMergeService {
  constructor(
    private readonly context: TenantContext,
    private readonly tx: TenantTransaction,
    private readonly surveys: SurveysService,
    private readonly mail: MailService,
    private readonly users: UserService,
    private readonly audit: AuditService,
  ) {}

  async preview(input: MailMergeInput, identity: AuthenticatedUser): Promise<MailMergePreview> {
    const actor = await this.users.resolveActor(identity);
    const clientIds = await this.surveys.cohortClientIds(input.audience);
    const t = this.context.tenantId;
    const merged = await this.tx.run(async (m) => {
      const [tpl] = await m.query('SELECT id, name, kind, body, active FROM document_templates WHERE tenant_id = $1 AND id = $2', [t, input.templateId]);
      if (!tpl) throw new BadRequestException('templateId must be a template of this organisation');
      if (tpl.kind !== 'mail' || !tpl.active) throw new BadRequestException('Choose an active e-mail template');
      const clients: { id: string; name: string; legal_name: string | null; kvk_number: string | null; vat_number: string | null; address: string | null; city: string | null; payment_terms: string }[] =
        clientIds.length ? await m.query('SELECT id, name, legal_name, kvk_number, vat_number, address, city, payment_terms FROM clients WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY name', [t, clientIds]) : [];
      const contacts: { id: string; client_id: string; first_name: string; last_name: string | null; email: string; is_primary: boolean }[] = clientIds.length
        ? await m.query(
            `SELECT id, client_id, first_name, last_name, email, is_primary FROM contacts
              WHERE tenant_id = $1 AND client_id = ANY($2::uuid[]) AND email IS NOT NULL AND btrim(email) <> ''
              ORDER BY is_primary DESC, created_at`,
            [t, clientIds],
          )
        : [];
      const [me] = await m.query(`SELECT COALESCE(NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), email) AS name FROM users WHERE id = $1`, [actor.id]);
      const mails: MergedMail[] = [];
      const clientsWithoutEmail: { id: string; name: string }[] = [];
      for (const c of clients) {
        const own = contacts.filter((x) => x.client_id === c.id);
        if (own.length === 0) {
          clientsWithoutEmail.push({ id: c.id, name: c.name });
          continue;
        }
        const primary = own[0];
        for (const contact of input.recipients === 'all' ? own : [primary]) {
          const name = fullName(contact.first_name, contact.last_name) || contact.email;
          const values: Record<string, string | null> = {
            'client.name': c.name, 'client.legalName': c.legal_name, 'client.kvk': c.kvk_number, 'client.vat': c.vat_number, 'client.address': c.address,
            'client.city': c.city, 'client.paymentTerms': c.payment_terms, 'contact.name': name, 'contact.firstName': contact.first_name,
            'contact.email': contact.email, primary_contact_name: fullName(primary.first_name, primary.last_name) || primary.email,
            'user.name': me?.name ?? null, today: new Date().toISOString().slice(0, 10),
          };
          const missing = new Set<string>();
          const fill = (s: string) =>
            s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
              const v = values[key];
              if (v === undefined || v === null || v === '') {
                missing.add(key);
                return `[${key}]`;
              }
              return v;
            });
          mails.push({ clientId: c.id, clientName: c.name, contactId: contact.id, contactName: name, email: contact.email, subject: fill(tpl.name).replace(/[\r\n]+/g, ' '), text: fill(tpl.body), missing: [...missing] });
        }
      }
      if (mails.length > MAX_MAILS) throw new BadRequestException(`At most ${MAX_MAILS} e-mails per batch; narrow the selection`);
      return { template: { id: tpl.id as string, name: tpl.name as string }, mails, clientsWithoutEmail };
    });
    return { ...merged, mail: await this.mail.status() };
  }

  async send(input: MailMergeInput, identity: AuthenticatedUser): Promise<{ sent: number; failed: { email: string; error: string }[] }> {
    const status = await this.mail.status();
    if (!status.configured) throw new ServiceUnavailableException('Sending e-mail from Agera is not connected. Set SMTP_HOST and SMTP_FROM in .env.production.');
    const actor = await this.users.resolveActor(identity);
    const { template, mails } = await this.preview(input, identity);
    if (mails.length === 0) throw new BadRequestException('No contacts with an e-mail address match this selection');
    const failed: { email: string; error: string }[] = [];
    for (const m of mails) {
      try {
        await this.mail.send({ to: m.email, subject: m.subject, text: m.text, replyTo: actor.email });
      } catch (error) {
        failed.push({ email: m.email, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const sent = mails.length - failed.length;
    this.audit.logAction(this.context.tenantId, actor.id, 'mail_merge.sent', { templateId: template.id, templateName: template.name, sent, failed: failed.length });
    return { sent, failed };
  }
}

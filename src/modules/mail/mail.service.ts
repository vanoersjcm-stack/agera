import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig, MailConfig } from '../../config/configuration.js';

export interface MailStatus {
  /** SMTP_HOST and SMTP_FROM are set. */
  configured: boolean;
  /** The relay accepted a connection (and login) during the last check. */
  connected: boolean;
  host: string | null;
  port: number;
  from: string | null;
  error: string | null;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  replyTo?: string | null;
}

/** Outgoing e-mail through a standard SMTP relay configured in .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM). */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly config: MailConfig;
  private readonly transporter: Transporter | null;
  private checked: { at: number; status: MailStatus } | null = null;

  constructor(config: ConfigService<AppConfig, true>) {
    this.config = config.get('mail', { infer: true });
    const { host, port, secure, user, pass, from } = this.config;
    this.transporter =
      host && from
        ? nodemailer.createTransport({
            host,
            port,
            secure,
            requireTLS: !secure,
            auth: user ? { user, pass: pass ?? '' } : undefined,
            connectionTimeout: 10_000,
          })
        : null;
  }

  /** Cached for one minute so the status screens don't open an SMTP session on every view. */
  async status(): Promise<MailStatus> {
    const base = { configured: this.transporter !== null, host: this.config.host, port: this.config.port, from: this.config.from };
    if (!this.transporter) return { ...base, connected: false, error: null };
    if (this.checked && Date.now() - this.checked.at < 60_000) return this.checked.status;
    let status: MailStatus;
    try {
      await this.transporter.verify();
      status = { ...base, connected: true, error: null };
    } catch (error) {
      status = { ...base, connected: false, error: error instanceof Error ? error.message : String(error) };
    }
    this.checked = { at: Date.now(), status };
    return status;
  }

  async send(mail: OutgoingMail): Promise<{ messageId: string }> {
    if (!this.transporter || !this.config.from) {
      throw new ServiceUnavailableException('Sending e-mail from Agera is not connected. Set SMTP_HOST and SMTP_FROM in .env.production.');
    }
    try {
      const info = await this.transporter.sendMail({
        from: this.config.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        replyTo: mail.replyTo ?? undefined,
      });
      return { messageId: info.messageId };
    } catch (error) {
      this.logger.warn(`SMTP relay refused a message: ${String(error)}`);
      this.checked = null;
      throw new ServiceUnavailableException('The e-mail server did not accept the message. Check the SMTP settings or try again later.');
    }
  }
}

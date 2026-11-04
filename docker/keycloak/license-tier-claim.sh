#!/usr/bin/env bash
# Runs inside the Keycloak container (idempotent). Puts the organisation's edition in access tokens as
# `tenant_license_tier`: lets admins store our tenant attributes on users and adds the claim mapper to both clients.
set -euo pipefail
CFG=$(mktemp)
trap 'rm -f "$CFG"' EXIT
kc() { /opt/keycloak/bin/kcadm.sh "$@" --config "$CFG"; }
user=${KC_BOOTSTRAP_ADMIN_USERNAME:-${KEYCLOAK_ADMIN:-}}
pass=${KC_BOOTSTRAP_ADMIN_PASSWORD:-${KEYCLOAK_ADMIN_PASSWORD:-}}
kc config credentials --server http://localhost:8080/auth --realm master --user "$user" --password "$pass" >/dev/null 2>&1 \
  || kc config credentials --server http://localhost:8080 --realm master --user "$user" --password "$pass" >/dev/null

profile=$(mktemp)
kc get users/profile -r agera > "$profile"
if ! grep -q '"unmanagedAttributePolicy"' "$profile"; then
  sed -i '0,/{/s//{ "unmanagedAttributePolicy" : "ADMIN_EDIT",/' "$profile"
  kc update users/profile -r agera -f "$profile" >/dev/null
  echo "user profile: tenant attributes are now kept (admin-edit only)"
fi
rm -f "$profile"

for client in agera-backend agera-frontend; do
  id=$(kc get clients -r agera -q clientId="$client" --fields id | sed -n 's/.*"id" : "\([^"]*\)".*/\1/p' | head -1)
  [[ -n $id ]] || continue
  if ! kc get "clients/$id/protocol-mappers/models" -r agera | grep -q '"name" : "tenant_license_tier"'; then
    kc create "clients/$id/protocol-mappers/models" -r agera -s name=tenant_license_tier -s protocol=openid-connect \
      -s protocolMapper=oidc-usermodel-attribute-mapper -s consentRequired=false \
      -s 'config."user.attribute"=tenant_license_tier' -s 'config."claim.name"=tenant_license_tier' \
      -s 'config."jsonType.label"=String' -s 'config."access.token.claim"=true' -s 'config."id.token.claim"=false' \
      -s 'config."userinfo.token.claim"=false' -s 'config."introspection.token.claim"=true' >/dev/null
    echo "$client: tenant_license_tier claim mapper added"
  fi
done

#!/command/with-contenv bash
# shellcheck shell=bash

# Renders the admin vhost (/etc/nginx/conf.d/production.conf) from its template.
# Two placeholders, both about who the admin UI will talk to:
#
#   NPM_ADMIN_PORT      the port the admin UI listens on (default 81), after
#                       falling back to 81 when the value is not a number.
#   AUTH_SSO_EDGE_PEERS the addresses allowed to vouch for a request as "it came
#                       through the SSO gateway" — the map in the template that
#                       becomes X-NPM-Edge. Empty by default (loopback only), so
#                       an upgrade without this set behaves exactly as before.
#
# (The file is still named for the port: a renamed prepare script would leave the
# old one in an image that overlays this tree, and both would then run.)

set -e

log_info 'Admin vhost ...'

NPM_ADMIN_PORT="${NPM_ADMIN_PORT:-81}"
# ensure admin port is a number
if ! [[ "$NPM_ADMIN_PORT" =~ ^[0-9]+$ ]]; then
	echo "WARNING: NPM_ADMIN_PORT must be a number. Defaulting to 81" >&2
	NPM_ADMIN_PORT=81
fi

# Peers are single addresses. Anything else — a CIDR, a hostname, a stray comma
# from a copy-paste — is dropped with a warning rather than rendered: a map entry
# that does not match its intended peer fails closed (the gateway gets "no" and
# the admin UI refuses its identity headers), while a *widened* entry would let a
# neighbouring container mint identities.
EDGE_PEERS=""
for peer in ${AUTH_SSO_EDGE_PEERS//,/ }; do
	if [[ "$peer" =~ ^[0-9a-fA-F:.]+$ ]]; then
		EDGE_PEERS+="${peer} \"yes\";"$'\n'
	else
		echo "WARNING: AUTH_SSO_EDGE_PEERS entry '$peer' is not an address; ignoring it" >&2
	fi
done
if [ -n "$EDGE_PEERS" ]; then
	log_info "Edge peers: $(echo "$EDGE_PEERS" | tr '\n' ' ')"
fi

PRODFILE="/etc/nginx/conf.d/production.conf"
SED_REGEX="s/\{\{NPM_ADMIN_PORT\}\}/${NPM_ADMIN_PORT}/g"

if is_mounted "$PRODFILE"; then
	echo "WARNING: skipping ${PRODFILE} — mounted file" >&2
elif [ -f "$PRODFILE.template" ]; then
	# The peers block is a set of lines, not a value sed can substitute into the
	# middle of one, so it goes in with awk after the scalar substitution.
	# Only a line that is nothing but the placeholder is replaced: the template
	# mentions the placeholder in its comment too, and an unanchored match put
	# the map entries there (nginx: unknown directive, the admin UI down).
	if sed -E "$SED_REGEX" "$PRODFILE.template" \
		| awk -v peers="$EDGE_PEERS" '{ if ($0 ~ /^[[:space:]]*\{\{EDGE_PEERS\}\}[[:space:]]*$/) { printf "%s", peers } else print }' \
			> "$PRODFILE" && [ -s "$PRODFILE" ]; then
		# success
		log_info "Generated ${PRODFILE} from template"
	else
		log_fatal "Failed to generate ${PRODFILE} from template"
	fi
fi

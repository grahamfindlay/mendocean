# Email DNS setup

In Porkbun, open DNS for `katahdin.me` and add these records. The Host values below are relative to `katahdin.me`. Use the default TTL. Leave existing records unchanged.

| Type | Host | Value | Priority |
| --- | --- | --- | --- |
| TXT | `resend._domainkey.mail` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIjfqoQW1RRiZp3P6VmXG4jJjLHrzNgbOFS8sUUOcEODfDCv8h/WOimLo8mKjp6R/Gq21PFphbGLzFS5aVMZ8z9pQ01HvVuhOkPQln8SoNyy6Pg1E13eP+jDA9sxDvBIiU+J6bVac7rxt6W5Vy5SN9ksEHMxAZkBpBWySjqDdzqwIDAQAB` | — |
| MX | `send.mail` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` | — |
| CNAME | `rsend.mail` | `send.forge.rmta.net` | — |

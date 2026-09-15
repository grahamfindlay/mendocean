# Mendocean domain DNS

Target zone: `mendocean.fyi` in Cloudflare. Email records must be DNS-only. These replace the earlier katahdin.me setup instructions.

| Type | Name | Content | Priority | Proxy |
| --- | --- | --- | --- | --- |
| CNAME | `@` | `mendocean.pages.dev` | — | Proxied |
| TXT | `resend._domainkey.mail` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDBm8doSkRgq8ps2iXczYUF+wsMnQYnyuf80wS3jSmW04RvnNSSlcM0hiC5WB2Caq3GbG5mUqaXJFpSekKoaF7EaApy2gdeAQd1u8SJtjQQgYOqGuHXUyOHXzat6ABS6RZrOXalTq4hSwTs8w5P6FOgkYS82sEzEl9285bInmLvowIDAQAB` | — | DNS only |
| MX | `send.mail` | `feedback-smtp.us-east-1.amazonses.com` | 10 | DNS only |
| TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` | — | DNS only |
| CNAME | `rsend.mail` | `send.forge.rmta.net` | — | DNS only |

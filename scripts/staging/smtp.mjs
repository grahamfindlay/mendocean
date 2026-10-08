import { connect } from "node:tls";
import { assertStaging, secrets } from "./lib.mjs";
export async function smtpCheck() {
  await assertStaging();
  const s = secrets();
  const socket = connect({
    host: "smtp.resend.com",
    port: 465,
    servername: "smtp.resend.com",
    rejectUnauthorized: true,
  });
  let buffer = "",
    waiter;
  const responses = [];
  socket.setEncoding("utf8");
  socket.setTimeout(15000, () => socket.destroy(new Error("SMTP timeout")));
  socket.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (/^\d{3} /.test(line)) {
        const code = Number(line.slice(0, 3));
        if (waiter) {
          const w = waiter;
          waiter = null;
          w.resolve(code);
        } else responses.push(code);
      }
    }
  });
  socket.on("error", () => {
    if (waiter) {
      waiter.reject(
        new Error("Staging SMTP connection failed; diagnostics withheld."),
      );
      waiter = null;
    }
  });
  const next = () =>
    responses.length
      ? Promise.resolve(responses.shift())
      : new Promise((resolve, reject) => {
          waiter = { resolve, reject };
        });
  const command = async (value, expected) => {
    socket.write(value + "\r\n");
    if ((await next()) !== expected)
      throw new Error("Staging SMTP authentication rejected.");
  };
  try {
    if ((await next()) !== 220)
      throw new Error("Staging SMTP greeting unavailable.");
    await command("EHLO mendocean-staging.pages.dev", 250);
    await command("AUTH LOGIN", 334);
    await command(Buffer.from("resend").toString("base64"), 334);
    await command(Buffer.from(s.RESEND_API_KEY).toString("base64"), 235);
    await command("QUIT", 221);
    console.log(
      "Verified SMTP TLS and authentication; no email sent by this check.",
    );
  } finally {
    socket.destroy();
  }
}

import nodemailer, { type Transporter } from 'nodemailer'
import { config } from './config'

type Mail = { to: string; subject: string; text: string; html?: string; replyTo?: string }

interface Mailer {
  send(mail: Mail): Promise<void>
}

class SmtpMailer implements Mailer {
  private transport: Transporter

  constructor(private smtp: NonNullable<typeof config.smtp>) {
    this.transport = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: smtp.auth })
  }

  async send({ to, subject, text, html, replyTo }: Mail) {
    await this.transport.sendMail({ from: this.smtp.from, to, subject, text, html, replyTo })
  }
}

class ConsoleMailer implements Mailer {
  async send({ to, subject, text, html, replyTo }: Mail) {
    const headers = [`To: ${to}`, ...(replyTo ? [`Reply-To: ${replyTo}`] : []), `Subject: ${subject}`].join('\n')
    const body = html ? `${text}\n\n--- HTML ---\n${html}` : text
    console.info(`[mail] SMTP 未設定のため送信せずに出力します\n${headers}\n\n${body}\n`)
  }
}

export const mailer: Mailer = config.smtp ? new SmtpMailer(config.smtp) : new ConsoleMailer()

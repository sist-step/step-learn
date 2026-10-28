import nodemailer, { type Transporter } from 'nodemailer'
import { config } from './config'

type Mail = { to: string; subject: string; text: string }

let transport: Transporter | undefined

export async function sendMail({ to, subject, text }: Mail) {
  const smtp = config.smtp
  if (!smtp) {
    console.info(`[mail] SMTP 未設定のため送信せずに出力します\nTo: ${to}\nSubject: ${subject}\n\n${text}\n`)
    return
  }
  transport ??= nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, auth: smtp.auth })
  await transport.sendMail({ from: smtp.from, to, subject, text })
}

import 'dotenv/config';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Client } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import nodemailer from 'nodemailer';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Configuration interfaces
interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface ServerConfig {
  email: EmailConfig;
  openai: {
    apiKey: string;
  };
  gemini: {
    apiKey: string;
  };
}

class WhatsAppEmailMCPServer {
  private server: Server;
  private whatsappClient!: typeof Client.prototype;
  private emailTransporter!: ReturnType<typeof nodemailer.createTransport>;
  private genAI!: GoogleGenerativeAI;
  private model: any;
  private config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
    this.server = new Server({
      name: "whatsapp-email-server",
      version: "1.0.0",
      capabilities: {
        tools: {},
      },
    });

    this.setupWhatsApp();
    this.setupEmail();
    this.setupGemini();
    this.setupHandlers();
  }

  private setupWhatsApp() {
    this.whatsappClient = new Client({
      puppeteer: {
        headless: true
      }
    });

    this.whatsappClient.on('qr', (qr) => {
      console.log('WhatsApp QR Code:');
      qrcode.generate(qr, { small: true });
    });

    this.whatsappClient.on('ready', () => {
      console.log('WhatsApp Client is ready!');
    });

    this.whatsappClient.on('message', async (message) => {
      await this.handleWhatsAppMessage(message);
    });
  }

  private setupEmail() {
    this.emailTransporter = nodemailer.createTransport(this.config.email);
  }

  private setupGemini() {
    this.genAI = new GoogleGenerativeAI(this.config.gemini.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "send_email_from_whatsapp",
          description: "Process WhatsApp message and send email automatically",
          inputSchema: {
            type: "object",
            properties: {
              whatsappMessage: {
                type: "string",
                description: "Raw WhatsApp message content"
              }
            },
            required: ["whatsappMessage"]
          }
        },
        {
          name: "start_whatsapp_listener",
          description: "Start listening for WhatsApp messages",
          inputSchema: {
            type: "object",
            properties: {}
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "send_email_from_whatsapp":
          if (!args || typeof args.whatsappMessage !== 'string') {
            throw new Error("Invalid arguments: 'whatsappMessage' must be a string.");
          }
          return await this.processWhatsAppMessage(args.whatsappMessage);

        case "start_whatsapp_listener":
          return await this.startWhatsAppListener();

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    });
  }

  private async handleWhatsAppMessage(message: any) {
    try {
      const messageText = message.body;
      console.log(`Received WhatsApp message: ${messageText}`);

      const emailData = await this.parseWhatsAppMessage(messageText);

      if (emailData) {
        const result = await this.sendEnhancedEmail(emailData);
        await message.reply(`✅ Email sent successfully to ${emailData.recipient}!\nSubject: ${result.subject}`);
      } else {
        await message.reply("❌ Could not parse your message. Please use format: 'recipient@email.com: your context here'");
      }
    } catch (error) {
      console.error('Error handling WhatsApp message:', error);
      const err = error as Error;
      await message.reply(`❌ Error sending email: ${err.message}`);
    }
  }

  private async parseWhatsAppMessage(message: string): Promise<{ recipient: string, context: string } | null> {
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}):\s*(.+)/;
    const match = message.match(emailRegex);

    if (match) {
      return {
        recipient: match[1].trim(),
        context: match[2].trim()
      };
    }

    try {
      const prompt = `Extract email recipient and context from this WhatsApp message: "${message}"
Return JSON format with 'recipient' and 'context' fields. If no valid email found, return null.
Example: {"recipient": "john@email.com", "context": "follow up meeting"}`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const parsed = JSON.parse(text);

      return parsed.recipient && parsed.context ? parsed : null;
    } catch (error) {
      console.error('AI parsing failed:', error);
      return null;
    }
  }

  private async generateEmailContent(context: string): Promise<{ subject: string, body: string }> {
    const prompt = `You are an AI assistant that creates professional emails. Given a brief context, generate:
1. A clear, professional subject line
2. A well-structured email body that expands on the context appropriately

Keep the tone professional but friendly. The email should be complete and ready to send.

Context: ${context}

Please format your response as:
Subject: [your subject line]

[your email body content]`;

    const result = await this.model.generateContent(prompt);
    const response = await result.response;
    const content = response.text();

    const subjectMatch = content.match(/Subject:\s*(.+)/i);
    const subject = subjectMatch ? subjectMatch[1].trim() : `Regarding: ${context.substring(0, 50)}...`;
    const body = content.replace(/Subject:\s*.+\n*/i, '').trim();

    return { subject, body };
  }

  private async sendEnhancedEmail(emailData: { recipient: string, context: string }) {
    const { subject, body } = await this.generateEmailContent(emailData.context);

    const mailOptions = {
      from: this.config.email.auth.user,
      to: emailData.recipient,
      subject: subject,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          ${body.replace(/\n/g, '<br>')}
          <br><br>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">
            This email was sent automatically via WhatsApp integration.
          </p>
        </div>
      `,
      text: body
    };

    await this.emailTransporter.sendMail(mailOptions);
    return { subject, body };
  }

  private async processWhatsAppMessage(whatsappMessage: string) {
    try {
      const emailData = await this.parseWhatsAppMessage(whatsappMessage);

      if (!emailData) {
        return {
          content: [{
            type: "text",
            text: "Could not parse WhatsApp message. Expected format: 'recipient@email.com: context'"
          }]
        };
      }

      const result = await this.sendEnhancedEmail(emailData);

      return {
        content: [{
          type: "text",
          text: `Email sent successfully!\nRecipient: ${emailData.recipient}\nSubject: ${result.subject}\nPreview: ${result.body.substring(0, 100)}...`
        }]
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: [{
          type: "text",
          text: `Error: ${err.message}`
        }]
      };
    }
  }

  private async startWhatsAppListener() {
    try {
      await this.whatsappClient.initialize();
      return {
        content: [{
          type: "text",
          text: "WhatsApp listener started. Scan the QR code to connect."
        }]
      };
    } catch (error) {
      const err = error as Error;
      return {
        content: [{
          type: "text",
          text: `Error starting WhatsApp: ${err.message}`
        }]
      };
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log("WhatsApp Email MCP Server running on stdio");
  }
}

// Configuration - Update with your credentials
const config: ServerConfig = {
  email: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER || 'your-email@gmail.com',
      pass: process.env.EMAIL_PASS || 'your-app-password'
    }
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || 'your-openai-api-key'
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || 'your-gemini-api-key'
  }
};

const server = new WhatsAppEmailMCPServer(config);
server.run().catch(console.error);

export default WhatsAppEmailMCPServer;

import 'dotenv/config';
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
declare class WhatsAppEmailMCPServer {
    private server;
    private whatsappClient;
    private emailTransporter;
    private genAI;
    private model;
    private config;
    constructor(config: ServerConfig);
    private setupWhatsApp;
    private setupEmail;
    private setupGemini;
    private setupHandlers;
    private handleWhatsAppMessage;
    private parseWhatsAppMessage;
    private generateEmailContent;
    private sendEnhancedEmail;
    private processWhatsAppMessage;
    private startWhatsAppListener;
    run(): Promise<void>;
}
export default WhatsAppEmailMCPServer;
//# sourceMappingURL=index.d.ts.map
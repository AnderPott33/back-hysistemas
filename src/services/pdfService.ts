import puppeteer from 'puppeteer';
import handlebars from 'handlebars';
import fs from 'fs-extra';
import path from 'path';

handlebars.registerHelper('eq', function (a, b) {
    return a === b;
});

export const generatePdfService = async (
    templateName: string,
    data: any,
    logoFileName: string = 'logoOwlSoft.png'
): Promise<Buffer> => {
    let browser;
    try {
        // 1. Procesar el Logo (Ruta relativa a la raíz del proyecto)
        const logoPath = path.join(process.cwd(), 'src', 'templates', 'assets', logoFileName);
        let logoDataUri = '';

        try {
            if (await fs.pathExists(logoPath)) {
                const logoBase64 = fs.readFileSync(logoPath, { encoding: 'base64' });
                logoDataUri = `data:image/png;base64,${logoBase64}`;
            }
        } catch (err) {
            console.error(`Error al procesar el logo ${logoFileName}:`, err);
        }

        // 2. Ruta del Template HTML
        const filePath = path.join(process.cwd(), 'src', 'templates', 'partials', `${templateName}.html`);

        if (!await fs.pathExists(filePath)) {
            throw new Error(`Modelo ${templateName} no encontrado en: ${filePath}`);
        }

        const html = await fs.readFile(filePath, 'utf-8');
        const template = handlebars.compile(html);

        // Inyectamos el logo procesado en los datos del template
        const finalHtml = template({
            ...data,
            logo_empresa: logoDataUri
        });

        // 3. Configuración de Puppeteer
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        // Solución al error de tipos TS(2322):
        // Cargamos el HTML y esperamos a que el DOM esté listo
        await page.setContent(finalHtml, { waitUntil: 'load' });

        // Pequeña espera para asegurar que el Base64 se renderice (especialmente en servidores lentos)
        await page.evaluateHandle('document.fonts.ready');

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '15mm', bottom: '15mm', left: '10mm', right: '10mm' }
        });

        return Buffer.from(pdfBuffer);

    } catch (error) {
        console.error("Error en generatePdfService:", error);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
};
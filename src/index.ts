import 'dotenv/config';
import { initializeDatabase } from './db/datosIniciales.js'; // Importas la función que me pasaste

async function startServer() {
    try {

        await initializeDatabase(); 

        const { default: app } = await import('./server.js');
        
        const PORT = process.env.PORT || 3000;
        app.listen(PORT, () => {
            console.log(`----------------------------------------------`);
            console.log(`🚀 Owl-Soft ERP corriendo en el puerto ${PORT}`);
            console.log(`----------------------------------------------`);
        });

    } catch (error) {
        console.error('💥 Error crítico al iniciar el sistema:', error);
        process.exit(1);
    }
}

startServer();
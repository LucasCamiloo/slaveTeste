const config = {
    mongoUri: process.env.MONGODB_URI || 'mongodb+srv://admin:0000@cluster0.tfg20.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
    port: process.env.PORT || 3000,
    baseUrl: process.env.VERCEL_URL ? 
        `https://${process.env.VERCEL_URL}` : 
        `http://localhost:${process.env.PORT || 3000}`,
    isDev: process.env.NODE_ENV !== 'production',
    masterUrl: process.env.MASTER_URL || 'https://master-coral.vercel.app'
};

export default config;

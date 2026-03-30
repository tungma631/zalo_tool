import { Zalo } from 'zca-js';

// @ts-ignore
const z = new Zalo({});

z.loginQR({ language: 'vi' }, (event: any) => {
    console.log("EVENT TYPE:", event.type);
    if (event.type === 0) {
        console.log("Got QR Code!", typeof event.data.image);
        process.exit(0);
    }
}).catch(console.error);

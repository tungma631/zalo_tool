const { Zalo } = require('zca-js');

const z = new Zalo({});
z.loginQR({ language: 'vi' }, (event) => {
    console.log("EVENT TYPE:", event.type);
    if (event.type === 0) {
        console.log("Got QR Code! event.data.image length:", event.data.image.length);
        console.log("Got QR Code! starts with:", event.data.image.substring(0, 50));
        process.exit(0);
    }
}).catch(console.error);

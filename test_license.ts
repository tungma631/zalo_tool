import { request } from 'undici';

async function testGoogleApi() {
    const url = "https://script.google.com/macros/s/AKfycbyjxl043gbOq-fLutJuziQcyICELExc9V5FntpfLjtGd5Z-IxFKPO9mhi9RrOVbz1fY/exec?action=validate&key=123&hwid=abc";
    console.log("Testing GET URL:", url);

    try {
        const res = await fetch(url, { method: 'GET' });
        const bodyStr = await res.text();
        console.log("========== HTTP FETCH STATUS ==========");
        console.log(res.status);
        console.log("========== HTTP FETCH HEADERS ==========");
        console.log(Object.fromEntries(res.headers.entries()));
        console.log("========== HTTP FETCH BODY ==========");
        console.log(bodyStr.substring(0, 1000));
    } catch(e: any) {
        console.error("Fetch failed:", e.message);
    }
}

testGoogleApi();

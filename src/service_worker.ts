var socket = new WebSocket('ws://localhost:3850');

socket.onopen = function() {
    console.log('WebSocket connection established');
};

socket.onmessage = function(event) {
    console.log('Message from server ', event.data);
};


socket.onclose = function(event) {
    if (event.wasClean) {
        console.log(`[close] Connection closed cleanly, code=${event.code} reason=${event.reason}`);
    } else {
        console.log('[close] Connection died');
    }
};

socket.onerror = function(error) {
    console.log(`[error] ${error}`);
};

chrome.runtime.onInstalled.addListener(async () => {
    let i = await chrome.storage.local.get();
    if (i.installed != null) {
        return;
    }
    await chrome.storage.local.set({installed: true});
    await chrome.tabs.create({
      url: 'thanks.html',
    });
});

interface Header {
    key: string;
    value: string;
};

interface Cookie {
    Domain ?: string;
    Name: string;
    Value: string;
    Expires ?: string;
    Path ?: string;
    HttpOnly: boolean;
    Secure: boolean;
    SameSite ?: string;
};

let headerStore = new Map<string, chrome.webRequest.WebRequestHeadersDetails>();

chrome.downloads.onCreated.addListener((downloadItem: chrome.downloads.DownloadItem) => {
    let headers = headerStore.get(downloadItem.url);
    chrome.downloads.cancel(downloadItem.id, () => {
        chrome.cookies.getAll({url: downloadItem.url}, (cookies) => {
            let cookedies: Cookie[] = cookies.map((cookie) => {
                let expDate: string|undefined = undefined;
                if (cookie.expirationDate != undefined) {
                    expDate = new Date(cookie.expirationDate).toISOString();
                }
                return {
                    Domain: cookie.domain,
                    Name: cookie.name,
                    Value: cookie.value,
                    Expires: expDate,
                    Path: cookie.path,
                    HttpOnly: cookie.httpOnly,
                    Secure: cookie.secure,
                    // SameSite: cookie.sameSite,
                };
            });
            let cookied_headers: Header[]|undefined = undefined;
            console.log("Headers: ", headers);
            console.log("Cookies: ", cookedies);
            if (headers != undefined && headers.requestHeaders != undefined) {
                cookied_headers = headers!.requestHeaders!.map((header) => {
                    return {
                        key: header.name,
                        value: header.value,
                    };
                }) as Header[];
            }
            socket.send(JSON.stringify({
                url: downloadItem.url,
                headers: cookied_headers,
                cookies: cookedies,
            }));
        });
    });
});

chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
        headerStore.set(details.url, details);
    },
    {urls: ['<all_urls>']},
    []
)

chrome.webRequest.onBeforeRedirect.addListener(
    (details) => {
        let data = headerStore.get(details.url)!;
        headerStore.delete(details.url);
        headerStore.set(details.redirectUrl, data);
    },
    {urls: ['<all_urls>']},
    []
)

chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
        headerStore.delete(details.url);
    },
    {urls: ['<all_urls>']},
    []
)

chrome.webRequest.onCompleted.addListener(
    (details) => {
        headerStore.delete(details.url);
    },
    {urls: ['<all_urls>']},
    []
)
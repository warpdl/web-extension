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

chrome.downloads.onCreated.addListener((downloadItem: chrome.downloads.DownloadItem) => {
    chrome.downloads.cancel(downloadItem.id, () => {
        chrome.cookies.getAll({url: downloadItem.url}, (cookies) => {
        });
    });
});

let headerStore = new Map<string, chrome.webRequest.WebRequestHeadersDetails>();

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
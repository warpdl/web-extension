// chrome.runtime.onInstalled.addListener(() => {
//     chrome.windows.create({
//       url: 'thanks.html',
//       type: 'popup',
//       width: 400,
//       height: 500
//     });
// });

chrome.downloads.onCreated.addListener((downloadItem) => {
    var cookieString = '';
    chrome.downloads.cancel(downloadItem.id, () => {
        chrome.cookies.getAll({url: downloadItem.url}, (cookies) => {
            console.log(cookies);
        });
    });
    console.log(cookieString);
    console.log(downloadItem);
});
  
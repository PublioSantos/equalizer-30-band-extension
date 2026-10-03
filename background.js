chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["eq30_gains"], (res) => {
    if (!res.eq30_gains) {
      chrome.storage.local.set({ eq30_gains: new Array(30).fill(0) });
    }
  });
});

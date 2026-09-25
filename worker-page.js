import { activateSearchSubmit, formatSearchPathLog, planNextPage, clickPlannedNext, typeAndSubmitSearch } from "./src/core/search-box.js";

// Runs on every Etsy page so a worker lane can type into the search box from
// the homepage, not only from an existing results URL.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ error: "unauthorized" });
    return true;
  }
  if (message?.action === "worker.typeAndSubmit") {
    const input = message.input || {};
    typeAndSubmitSearch(document, input.term, {
      submit: false,
      keystrokeMinMs: input.keystrokeMinMs,
      keystrokeMaxMs: input.keystrokeMaxMs,
    }).then((result) => {
      console.info(formatSearchPathLog(result));
      sendResponse(result);
      if (result.ok && result.path === "search_box") {
        setTimeout(() => activateSearchSubmit(document), 40);
      }
    });
    return true;
  }
  if (message?.action === "worker.clickNext") {
    const plan = planNextPage(document, message.input?.currentPage);
    console.info(formatSearchPathLog(plan));
    sendResponse(plan);
    if (plan.ok) setTimeout(() => clickPlannedNext(document, plan), 40);
    return true;
  }
  return false;
});

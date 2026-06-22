// content.js
// This script runs on LeetCode problem pages

const LEETCODE_GRAPHQL_ENDPOINT = 'https://leetcode.com/graphql';

// Helper to wait
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Intercept network requests is hard from content script alone due to modern browser restrictions.
// Instead, we will poll for submission status if we detect the user clicked a "Submit" button.

let lastSubmitTime = 0;

function getProblemSlug() {
    return window.location.pathname.split('/')[2];
}

document.addEventListener('click', (e) => {
  // Try to identify submit button clicks.
  // The submit button in modern leetcode often has specific data-e2e locators or specific classes
  const target = e.target.closest('[data-e2e-locator="console-submit-button"]') ||
                 e.target.closest('button:contains("Submit")') ||
                 (e.target.tagName === 'BUTTON' && e.target.textContent.includes('Submit'));

  if (target) {
    console.log("Submit button clicked!");
    lastSubmitTime = Date.now();
    pollForSubmissionSuccess();
  }
});

// Since identifying the submit button perfectly can be tricky, we can also use a MutationObserver
// to look for the "Accepted" text appearing in the results pane.
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      const addedNodes = Array.from(mutation.addedNodes);
      for (const node of addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Look for "Accepted" or specific success classes
          if (node.innerText && node.innerText.includes('Accepted') && node.innerText.includes('Runtime')) {
             if (Date.now() - lastSubmitTime < 30000) { // If within 30s of a click, or just generally recently
               handleSuccessfulSubmission();
               observer.disconnect(); // Prevent multiple triggers for the same submission
               // Reconnect after some time
               setTimeout(() => observer.observe(document.body, { childList: true, subtree: true }), 10000);
             }
          }
        }
      }
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });

async function pollForSubmissionSuccess() {
   // A simple polling mechanism checking recent submissions via GraphQL
   // It's usually safer and more reliable than DOM scraping alone.
   const currentSlug = getProblemSlug();
   for(let i=0; i<10; i++) { // poll 10 times, 3 seconds apart (30s total)
      await sleep(3000);
      try {
        const recentSubmissions = await getRecentSubmissions(currentSlug);
        if (recentSubmissions && recentSubmissions.length > 0) {
           const latest = recentSubmissions[0];
           // Check if it's accepted and recent
           if (latest.statusDisplay === "Accepted" && (Date.now()/1000 - latest.timestamp) < 60) {
              console.log("Found recent accepted submission!");
              await processSubmission(latest.id);
              return;
           }
        }
      } catch (e) {
        console.error("Polling error", e);
      }
   }
}


// Function to get CSRF token from cookies
function getCSRFToken() {
    const name = "csrftoken=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    for(let i = 0; i <ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') {
            c = c.substring(1);
        }
        if (c.indexOf(name) == 0) {
            return c.substring(name.length, c.length);
        }
    }
    return "";
}

async function getRecentSubmissions(slug) {
  const query = `
    query submissionList($offset: Int!, $limit: Int!, $questionSlug: String!) {
      questionSubmissionList(
        offset: $offset
        limit: $limit
        questionSlug: $questionSlug
      ) {
        submissions {
          id
          statusDisplay
          lang
          timestamp
        }
      }
    }
  `;
  const variables = { offset: 0, limit: 5, questionSlug: slug };
  const csrfToken = getCSRFToken();

  const res = await fetch(LEETCODE_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-csrftoken': csrfToken
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  return data.data.questionSubmissionList.submissions;
}

async function getSubmissionDetails(submissionId) {
  const query = `
    query submissionDetails($submissionId: Int!) {
      submissionDetails(submissionId: $submissionId) {
        code
        runtimeDisplay
        memoryDisplay
      }
    }
  `;
  const variables = { submissionId: parseInt(submissionId) };
  const csrfToken = getCSRFToken();

  const res = await fetch(LEETCODE_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-csrftoken': csrfToken
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  return data.data.submissionDetails;
}

async function getProblemDetails(slug) {
  const query = `
    query questionData($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        questionFrontendId
        title
        titleSlug
        content
        difficulty
        topicTags {
          name
        }
      }
    }
  `;
  const variables = { titleSlug: slug };
  const csrfToken = getCSRFToken();

  const res = await fetch(LEETCODE_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-csrftoken': csrfToken
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  return data.data.question;
}

// Fallback if mutation observer catches it but we didn't use polling
let processing = false;
async function handleSuccessfulSubmission() {
    if(processing) return;
    processing = true;
    console.log("Handling successful submission via DOM detection");
    try {
        const currentSlug = getProblemSlug();
        const recentSubmissions = await getRecentSubmissions(currentSlug);
        if (recentSubmissions && recentSubmissions.length > 0) {
           const latest = recentSubmissions[0];
           if (latest.statusDisplay === "Accepted") {
               await processSubmission(latest.id);
           }
        }
    } catch(e) {
        console.error(e);
    } finally {
        processing = false;
    }
}

async function processSubmission(submissionId, lang) {
  console.log(`Processing submission ${submissionId}`);
  try {
      const currentSlug = getProblemSlug();
      const [submissionDetails, problemDetails] = await Promise.all([
          getSubmissionDetails(submissionId),
          getProblemDetails(currentSlug)
      ]);

      const payload = {
          type: "LEETCODE_SUBMISSION",
          data: {
              submissionId,
              code: submissionDetails.code,
              runtime: submissionDetails.runtimeDisplay,
              memory: submissionDetails.memoryDisplay,
              lang: lang,
              problem: {
                  id: problemDetails.questionFrontendId,
                  title: problemDetails.title,
                  slug: problemDetails.titleSlug,
                  difficulty: problemDetails.difficulty,
                  content: problemDetails.content,
                  topics: problemDetails.topicTags.map(t => t.name)
              }
          }
      };

      console.log("Sending submission data to background script", payload);

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          try {
              chrome.runtime.sendMessage(payload, (response) => {
                  if (chrome.runtime.lastError) {
                      console.error("Extension context invalidated or background script not reachable:", chrome.runtime.lastError.message);
                      return;
                  }

                  if (response && response.success) {
                      console.log("Successfully pushed to GitHub!");
                      // Could optionally inject a success message into the UI here
                  } else {
                      console.error("Failed to push to GitHub:", response?.error);
                  }
              });
          } catch (e) {
              console.error("Error communicating with background script. Extension context might be invalidated. Please refresh the page.", e);
          }
      } else {
          console.error("chrome.runtime.sendMessage is not available. Extension context may be invalidated. Please refresh the page.");
      }
  } catch (error) {
      console.error("Error processing submission:", error);
  }
}

// In case the script is loaded on a submission page directly
if (window.location.pathname.includes('/submissions/')) {
    // we could handle direct submission viewing, but focusing on problem page for now
}

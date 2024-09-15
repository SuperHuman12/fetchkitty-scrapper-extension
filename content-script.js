console.log("Content script loaded for Fetch Kitty Scrapper");

let extensionActive = true;

function sendMessageToExtension(message) {
  return new Promise((resolve, reject) => {
    if (!extensionActive) {
      reject(new Error("Extension is not active"));
      return;
    }

    try {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          console.error('Chrome runtime error:', chrome.runtime.lastError);
          extensionActive = false;
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (error) {
      console.error('Error sending message to extension:', error);
      extensionActive = false;
      reject(error);
    }
  });
}

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;

  if (event.data.type === 'CHECK_EXTENSION_STATUS') {
    window.postMessage({ type: 'EXTENSION_STATUS', status: extensionActive }, '*');
  } else if (event.data.type === 'EXTRACT_DATA') {
    if (!extensionActive) {
      window.postMessage({ 
        type: 'EXTRACTION_ERROR', 
        error: 'Extension is not active',
        details: 'The extension context may have been invalidated. Please refresh the page.'
      }, '*');
      return;
    }

    try {
      const response = await sendMessageToExtension({ 
        action: 'extractData', 
        url: event.data.url 
      });

      window.postMessage({ 
        type: 'EXTRACTED_DATA', 
        url: event.data.url, 
        data: {
          title: response.title,
          content: response.content,
          url: response.url,
          excerpt: response.excerpt,
          byline: response.byline,
          direction: response.dir,
          extractedImages: response.extractedImages
        }
      }, '*');
    } catch (error) {
      window.postMessage({ 
        type: 'EXTRACTION_ERROR', 
        error: error.message,
        details: 'An error occurred while extracting data. Please try again.'
      }, '*');
    }
  }
});

// Check extension status periodically
function checkExtensionStatus() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    extensionActive = true;
    window.postMessage({ type: 'EXTENSION_STATUS', status: true }, '*');
  } else {
    extensionActive = false;
    window.postMessage({ type: 'EXTENSION_STATUS', status: false }, '*');
  }
}

// Check status immediately and then every 5 seconds
checkExtensionStatus();
setInterval(checkExtensionStatus, 5000);

// Notify the web app that the extension is ready
window.postMessage({ type: 'EXTENSION_STATUS', status: true }, '*');
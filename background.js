// background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractData') {
    chrome.tabs.create({ url: request.url, active: false }, (tab) => {
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['readability.js']
          }, () => {
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              function: extractContentWithReadability
            }, (results) => {
              chrome.tabs.remove(tab.id);
              if (chrome.runtime.lastError) {
                console.error('Extraction error:', chrome.runtime.lastError);
                sendResponse({ error: chrome.runtime.lastError.message });
              } else if (results && results[0] && results[0].result) {
                console.log('Sending extracted data:', JSON.stringify(results[0].result, null, 2));
                sendResponse(results[0].result);
              } else {
                console.error('Unexpected result structure:', results);
                sendResponse({ error: 'Unexpected result structure', details: JSON.stringify(results) });
              }
            });
          });
        }
      });
    });
    return true; // Indicates an async response
  }
});

function extractContentWithReadability() {
  try {
    const documentClone = document.cloneNode(true);
    const article = new Readability(documentClone).parse();
    if (article) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(article.content, 'text/html');
      let inlineImages = [];

      // Process images
      doc.querySelectorAll('img').forEach(img => {
        const imgSrc = img.src || img.getAttribute('data-src') || '';
        if (imgSrc) {
          inlineImages.push(imgSrc);
          img.src = imgSrc; // Ensure the src attribute is set
        }
      });

      // Process links
      doc.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href');
        if (href) {
          a.setAttribute('target', '_blank'); // Open links in new tab
          a.setAttribute('rel', 'noopener noreferrer'); // Security best practice
        }
      });

      // Preserve tables
      doc.querySelectorAll('table').forEach(table => {
        table.border = '1';
        table.style.borderCollapse = 'collapse';
        table.querySelectorAll('th, td').forEach(cell => {
          cell.style.border = '1px solid black';
          cell.style.padding = '5px';
        });
      });

      const processedContent = doc.body.innerHTML;

      // Extract additional images from CSS and other places
      const additionalImages = [];

      // Check inline styles
      document.querySelectorAll('*[style]').forEach(el => {
        const style = el.getAttribute('style');
        const match = style.match(/url\(['"]?(.*?)['"]?\)/);
        if (match) additionalImages.push(match[1]);
      });

      // Check CSS rules
      for (let i = 0; i < document.styleSheets.length; i++) {
        try {
          const rules = document.styleSheets[i].cssRules;
          for (let j = 0; j < rules.length; j++) {
            const rule = rules[j];
            if (rule.style && rule.style.backgroundImage) {
              const match = rule.style.backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
              if (match) additionalImages.push(match[1]);
            }
          }
        } catch (e) {
          console.warn('Unable to access stylesheet', e);
        }
      }

      return {
        title: article.title,
        content: processedContent,
        url: window.location.href,
        excerpt: article.excerpt,
        byline: article.byline,
        dir: article.dir,
        inlineImages: inlineImages,
        extractedImages: additionalImages
      };
    } else {
      throw new Error('Readability.js couldn\'t parse the content');
    }
  } catch (error) {
    console.error('Error in content extraction:', error);
    return { error: error.message };
  }
}
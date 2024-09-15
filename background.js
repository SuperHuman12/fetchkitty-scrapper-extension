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
      let allImages = new Set();

      // Function to extract image URLs from a string (for inline styles, CSS rules, etc.)
      function extractImageUrls(str) {
        const urls = [];
        const regex = /url\s*\(\s*(?:"|')?([^"')]+\.(?:png|jpg|jpeg|gif|webp|svg))(?:"|')?\s*\)/gi;
        let match;
        while ((match = regex.exec(str)) !== null) {
          urls.push(match[1]);
        }
        return urls;
      }

      // Function to add an image URL to allImages, resolving it to an absolute URL
      function addImage(url) {
        try {
          const absoluteUrl = new URL(url, document.baseURI).href;
          allImages.add(absoluteUrl);
        } catch (e) {
          console.warn('Invalid URL:', url);
        }
      }

      // Extract images from the whole document, not just the parsed article
      function extractImagesFromDocument(root) {
        // Process all elements for inline styles and attributes
        root.querySelectorAll('*').forEach(el => {
          // Check inline style
          if (el.style && el.style.cssText) {
            extractImageUrls(el.style.cssText).forEach(addImage);
          }

          // Check background-image attribute
          const bgImage = el.getAttribute('background-image');
          if (bgImage) addImage(bgImage);

          // Check src and data-src attributes
          ['src', 'data-src'].forEach(attr => {
            const value = el.getAttribute(attr);
            if (value && value.match(/\.(png|jpg|jpeg|gif|webp|svg)/i)) addImage(value);
          });

          // Special handling for <img> tags
          if (el.tagName === 'IMG') {
            ['src', 'data-src', 'srcset'].forEach(attr => {
              const value = el.getAttribute(attr);
              if (value) {
                value.split(',').forEach(src => {
                  const imgSrc = src.trim().split(' ')[0];
                  if (imgSrc.match(/\.(png|jpg|jpeg|gif|webp|svg)/i)) addImage(imgSrc);
                });
              }
            });
          }
        });

        // Process all stylesheets
        Array.from(document.styleSheets).forEach(sheet => {
          try {
            Array.from(sheet.cssRules || sheet.rules || []).forEach(rule => {
              if (rule.style && rule.style.cssText) {
                extractImageUrls(rule.style.cssText).forEach(addImage);
              }
            });
          } catch (e) {
            console.warn('Unable to access stylesheet', e);
          }
        });
      }

      // Extract images from both the original document and the parsed article
      extractImagesFromDocument(document);
      extractImagesFromDocument(doc);

      // Convert Set to Array
      const extractedImages = Array.from(allImages);

      return {
        title: article.title,
        content: article.content,
        url: window.location.href,
        excerpt: article.excerpt,
        byline: article.byline,
        dir: article.dir,
        length: article.length,
        extractedImages: extractedImages
      };
    } else {
      throw new Error('Readability.js couldn\'t parse the content');
    }
  } catch (error) {
    console.error('Error in content extraction:', error);
    return { error: error.message };
  }
}
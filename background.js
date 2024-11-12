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
    return true;
  }
});

function extractContentWithReadability() {
  try {
    // Process original document first to get all CTAs and links
    let allImages = new Set();
    let allLinks = [];

    // Before processing, remove all SVGs that are used for UI purposes
    function isUiSvg(svg) {
      if (!svg) return false;
      const rect = svg.getBoundingClientRect();
      
      // Small SVGs in navigation or buttons are likely UI elements
      if (rect.width <= 24 && rect.height <= 24) return true;
      if (svg.closest('nav, button, [role="button"], .btn, header')) return true;

      // Check for common UI patterns in paths
      const paths = svg.querySelectorAll('path');
      for (const path of paths) {
        const d = path.getAttribute('d');
        if (d && (d.includes('L6.5 7.125') || d.includes('M1.25 1.875'))) return true;
      }

      // Check for typical UI-related attributes
      if (svg.parentElement && (
        svg.parentElement.className.toLowerCase().includes('icon') ||
        svg.parentElement.className.toLowerCase().includes('button') ||
        svg.parentElement.className.toLowerCase().includes('dropdown')
      )) return true;

      return false;
    }

    // First pass: Remove UI SVGs
    document.querySelectorAll('svg').forEach(svg => {
      if (isUiSvg(svg)) {
        svg.remove();
      }
    });

    // Process all potential CTAs and links in the full document
    document.querySelectorAll('a, button, [role="button"], .btn, .button, .cta, [class*="apply"], [id*="apply"], [class*="action"], [id*="action"], [class*="cta"], [id*="cta"]').forEach(element => {
      try {
        let url = '';
        let text = element.textContent.trim();
        
        // Get URL from href or onclick or data attributes
        if (element.tagName === 'A') {
          url = element.getAttribute('href');
        } else if (element.onclick) {
          const onclickStr = element.onclick.toString();
          const urlMatch = onclickStr.match(/window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/);
          if (urlMatch) url = urlMatch[1];
        } else {
          // Check data-attributes for URLs
          for (let attr of element.attributes) {
            if (attr.name.startsWith('data-') && attr.value.includes('http')) {
              url = attr.value;
              break;
            }
          }
        }

        if (url && !url.startsWith('javascript:') && !url.startsWith('#')) {
          try {
            const absoluteUrl = new URL(url, document.baseURI).href;
            const rect = element.getBoundingClientRect();
            
            const linkData = {
              url: absoluteUrl,
              text: text,
              type: 'link',
              isButton: false,
              position: {
                top: rect.top,
                left: rect.left,
                bottom: rect.bottom,
                right: rect.right
              },
              classes: element.getAttribute('class') || '',
              id: element.getAttribute('id') || '',
              attributes: {}
            };

            // Gather all attributes
            Array.from(element.attributes).forEach(attr => {
              linkData.attributes[attr.name] = attr.value;
            });

            // Check if it's a CTA/button using multiple criteria
            if (
              element.matches('button') ||
              element.matches('a.button') ||
              element.className.toLowerCase().includes('btn') ||
              element.className.toLowerCase().includes('button') ||
              element.className.toLowerCase().includes('cta') ||
              element.className.toLowerCase().includes('apply') ||
              element.getAttribute('role') === 'button' ||
              element.id.toLowerCase().includes('cta') ||
              element.id.toLowerCase().includes('apply') ||
              text.toLowerCase().includes('apply') ||
              text.toLowerCase().includes('submit') ||
              text.toLowerCase().includes('get started') ||
              getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)' ||
              getComputedStyle(element).border !== 'none'
            ) {
              linkData.isButton = true;
              linkData.type = 'cta';
            }

            // Determine location in page
            if (rect.top < window.innerHeight * 0.2) {
              linkData.location = 'header';
            } else if (rect.bottom > document.documentElement.clientHeight * 0.8) {
              linkData.location = 'footer';
            } else {
              linkData.location = 'content';
            }

            allLinks.push(linkData);
          } catch (e) {
            console.warn('Error processing URL:', url);
          }
        }
      } catch (e) {
        console.warn('Error processing element:', e);
      }
    });

    // Now process with Readability
    const documentClone = document.cloneNode(true);
    
    // Remove UI SVGs from the clone before processing
    documentClone.querySelectorAll('svg').forEach(svg => {
      if (isUiSvg(svg)) {
        svg.remove();
      }
    });
    
    const article = new Readability(documentClone).parse();
    
    if (article) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(article.content, 'text/html');

      // Function to add image URL
      function addImage(url) {
        try {
          if (url) {
            const absoluteUrl = new URL(url, document.baseURI).href;
            if (!absoluteUrl.startsWith('data:') &&
                !absoluteUrl.includes('tracking') &&
                !absoluteUrl.includes('analytics') &&
                !absoluteUrl.match(/\.(js|css|json|xml)($|\?)/i)) {
              allImages.add(absoluteUrl);
            }
          }
        } catch (e) {
          console.warn('Invalid URL:', url);
        }
      }

      // Process all images from both document and article
      [document, doc].forEach(root => {
        // Process all images
        root.querySelectorAll('img').forEach(img => {
          const src = img.getAttribute('src');
          if (src) addImage(src);

          const srcset = img.getAttribute('srcset');
          if (srcset) {
            srcset.split(',').forEach(src => {
              const imgSrc = src.trim().split(' ')[0];
              addImage(imgSrc);
            });
          }

          // Handle data attributes
          ['data-src', 'data-original', 'data-lazy', 'data-srcset'].forEach(attr => {
            const value = img.getAttribute(attr);
            if (value) addImage(value);
          });
        });

        // Process background images
        root.querySelectorAll('*[style*="background"]').forEach(el => {
          const style = el.getAttribute('style');
          if (style) {
            const matches = style.match(/url\(['"]?([^'"]+)['"]?\)/g);
            if (matches) {
              matches.forEach(match => {
                const url = match.replace(/url\(['"]?([^'"]+)['"]?\)/i, '$1');
                addImage(url);
              });
            }
          }
        });
      });

      // Filter and clean up
      const uniqueLinks = allLinks.filter((link, index, self) => 
        index === self.findIndex((t) => t.url === link.url)
      );

      const extractedImages = Array.from(allImages).filter(url => {
        try {
          return url && !url.includes('undefined') && !url.includes('null');
        } catch (e) {
          return false;
        }
      });

      // Remove SVGs from the content before returning
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = article.content;
      tempDiv.querySelectorAll('svg').forEach(svg => {
        if (isUiSvg(svg)) {
          svg.remove();
        }
      });
      
      return {
        title: article.title,
        content: tempDiv.innerHTML,
        url: window.location.href,
        excerpt: article.excerpt,
        byline: article.byline,
        dir: article.dir,
        length: article.length,
        extractedImages: extractedImages,
        links: uniqueLinks
      };
    } else {
      throw new Error('Readability.js couldn\'t parse the content');
    }
  } catch (error) {
    console.error('Error in content extraction:', error);
    return { error: error.message };
  }
}
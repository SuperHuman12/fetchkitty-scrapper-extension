console.log("Content script loaded");

function filterImages(content) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/html');
  let filteredImages = [];

  doc.querySelectorAll('img').forEach(img => {
    const rect = img.getBoundingClientRect();
    if (rect.width >= 100 && rect.height >= 100 && isVisible(img)) {
      filteredImages.push(img.src);
    } else {
      img.parentNode.removeChild(img);
    }
  });

  // Process links
  doc.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href');
    if (href) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
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

  return {
    content: doc.body.innerHTML,
    filteredImages: filteredImages
  };
}

function isVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  if (event.data.type === 'CHECK_EXTENSION_STATUS') {
    window.postMessage({ type: 'EXTENSION_STATUS', status: true }, '*');
  } else if (event.data.type === 'EXTRACT_DATA') {
    chrome.runtime.sendMessage({ action: 'extractData', url: event.data.url }, (response) => {
      if (response.error) {
        console.error('Extraction error:', response.error);
        window.postMessage({ 
          type: 'EXTRACTION_ERROR', 
          error: response.error,
          details: response.details || 'No additional details available'
        }, '*');
      } else {
        console.log('Received extracted data in content script:', response);
        
        // Filter images
        const filteredData = filterImages(response.content);
        
        window.postMessage({ 
          type: 'EXTRACTED_DATA', 
          url: event.data.url, 
          data: {
            title: response.title,
            content: filteredData.content,
            url: response.url,
            excerpt: response.excerpt,
            byline: response.byline,
            direction: response.dir,
            extractedImages: filteredData.filteredImages.concat(response.extractedImages || [])
          }
        }, '*');
      }
    });
  }
});

// Notify the web app that the extension is ready
window.postMessage({ type: 'EXTENSION_STATUS', status: true }, '*');
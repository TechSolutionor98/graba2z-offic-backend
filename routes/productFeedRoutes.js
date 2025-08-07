import express from "express";
import axios from "axios";

const router = express.Router();

// XML feed route for Google Merchant Center
router.get('/products.xml', async (req, res) => {
  // Set a timeout for the entire request
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(408).send(`<?xml version="1.0" encoding="UTF-8"?>
<error>
  <message>Request timeout</message>
  <details>The request took too long to process (30 seconds)</details>
  <timestamp>${new Date().toISOString()}</timestamp>
</error>`);
    }
  }, 30000); // 30 second timeout

  try {
    console.log('Starting XML feed generation...');
    
    // Set response headers for XML
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
    });

    let products = [];
    
    // Try to fetch products from the local API
    try {
      console.log('Attempting to fetch products from /api/app/products...');
      
      const axiosConfig = {
        timeout: 15000, // 15 second timeout for API call
        baseURL: 'https://api.grabatoz.ae',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      };

      // Fetch all products without pagination
      const response = await axios.get('/api/products', { ...axiosConfig, params: { limit: 2000 } });
      console.log('API Response status:', response.status);
      console.log('Response data type:', typeof response.data);
      console.log('Response data keys:', Object.keys(response.data || {}));
      
      // Get products from response
      products = [];
      if (response.data && Array.isArray(response.data)) {
        products = response.data;  // Direct array response
      } else if (response.data && response.data.products) {
        products = response.data.products;  // Response with products property
      }
      
      console.log(`Fetched ${products.length} products from API.`);
      
      // Log the full response for debugging
      console.log('Full response data structure:', JSON.stringify({
        isArray: Array.isArray(response.data),
        hasProducts: !!response.data?.products,
        hasData: !!response.data?.data,
        firstLevelKeys: Object.keys(response.data || {})
      }, null, 2));
      
    } catch (apiError) {
      console.error('Error fetching products from API:', apiError.message);
      // If the API call fails, re-throw the error to be caught by the main try-catch block
      throw new Error(`Failed to fetch products from API: ${apiError.message}`);
    }

    console.log('Building XML...');

    // Start building XML
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Grabatoz Products</title>
    <link>https://grabatoz.ae</link>
    <description>Grabatoz Product Feed for Google Merchant Center</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`;

    // Add each product as an item
    if (products && Array.isArray(products) && products.length > 0) {
      console.log('Processing products...');
      
      products.forEach((product, index) => {
        // Ensure required fields exist
        const id = product._id || product.id || `product-${index}`;
        const title = escapeXml(product.name || product.title || 'Untitled Product');
        const description = escapeXml(product.description || product.shortDescription || title);
        const link = `https://grabatoz.ae/product/${product.slug || id}`;
        
        // Handle image URLs
        let imageLink = 'https://grabatoz.ae/placeholder.jpg'; // Default image
        if (product.images && product.images.length > 0) {
          const firstImage = product.images[0];
          if (typeof firstImage === 'string') {
            imageLink = firstImage.startsWith('http') ? firstImage : `https://grabatoz.ae${firstImage}`;
          } else if (firstImage && firstImage.url) {
            imageLink = firstImage.url.startsWith('http') ? firstImage.url : `https://grabatoz.ae${firstImage.url}`;
          }
        }
        
        const availability = (product.stock > 0 || product.countInStock > 0) ? 'in stock' : 'out of stock';
        const price = product.price ? `${product.price} AED` : '0 AED';
        const salePrice = product.salePrice && product.salePrice < product.price 
          ? `${product.salePrice} AED` 
          : '';
        const brand = escapeXml(product.brand?.name || product.brand || 'Grabatoz');
        const category = escapeXml(product.category?.name || product.category || 'General');
        const condition = 'new';
        const gtin = product.barcode || product.sku || id;

        xml += `
    <item>
      <g:id>${escapeXml(id)}</g:id>
      <g:title>${title}</g:title>
      <g:description>${description}</g:description>
      <g:link>${escapeXml(link)}</g:link>
      <g:image_link>${escapeXml(imageLink)}</g:image_link>
      <g:availability>${availability}</g:availability>
      <g:price>${escapeXml(price)}</g:price>`;

        if (salePrice) {
          xml += `
      <g:sale_price>${escapeXml(salePrice)}</g:sale_price>`;
        }

        xml += `
      <g:brand>${brand}</g:brand>
      <g:google_product_category>${category}</g:google_product_category>
      <g:product_type>${category}</g:product_type>
      <g:condition>${condition}</g:condition>
      <g:gtin>${escapeXml(gtin)}</g:gtin>
      <g:shipping>
        <g:country>AE</g:country>
        <g:service>Standard</g:service>
        <g:price>0 AED</g:price>
      </g:shipping>
    </item>`;
      });
    } else {
      console.log('No products found in API response. The feed will be empty.');
      // If no products are found, the channel will simply contain no items.
      // Google Merchant Center prefers an empty feed over a feed with sample data.
    }

    xml += `
  </channel>
</rss>`;

    console.log('XML generation complete, sending response...');
    clearTimeout(timeout);
    
    if (!res.headersSent) {
      res.send(xml);
    }

  } catch (error) {
    console.error('Fatal error generating product feed:', error);
    clearTimeout(timeout);
    
    if (!res.headersSent) {
      res.status(500).send(`<?xml version="1.0" encoding="UTF-8"?>
<error>
  <message>Error generating product feed</message>
  <details>${escapeXml(error.message)}</details>
  <timestamp>${new Date().toISOString()}</timestamp>
  <stack>${escapeXml(error.stack || 'No stack trace available')}</stack>
</error>`);
    }
  }
});

// Test route to check if the route is working
router.get('/test', (req, res) => {
  res.json({
    message: 'Product feed route is working',
    timestamp: new Date().toISOString(),
    endpoints: {
      xml_feed: '/feed/products.xml',
      test: '/feed/test',
      products_api: '/api/products'
    }
  });
});

// Helper function to escape XML special characters
function escapeXml(unsafe) {
  if (typeof unsafe !== 'string') {
    return String(unsafe || '');
  }
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

export default router;

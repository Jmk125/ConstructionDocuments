/**
 * Test script to diagnose pdf-parse module issues
 * Run with: node test-pdf-parse.js
 */

console.log('Testing pdf-parse module...\n');

// Test 1: Check if module can be required
console.log('1. Attempting to require pdf-parse...');
let pdfParse;
try {
  pdfParse = require('pdf-parse');
  console.log('   ✓ Module loaded');
} catch (error) {
  console.error('   ✗ Failed to load module:', error.message);
  process.exit(1);
}

// Test 2: Check module structure
console.log('\n2. Checking module structure...');
console.log('   Type of pdfParse:', typeof pdfParse);
console.log('   Type of pdfParse.default:', typeof pdfParse.default);
console.log('   Available keys:', Object.keys(pdfParse));
console.log('   Constructor name:', pdfParse.constructor ? pdfParse.constructor.name : 'none');

// Test 3: Determine correct way to use it
console.log('\n3. Determining correct usage...');
const pdf = typeof pdfParse === 'function' ? pdfParse : pdfParse.default;
console.log('   Using pdf as:', typeof pdf === 'function' ? 'function' : typeof pdf);

if (typeof pdf !== 'function') {
  console.error('   ✗ Cannot determine how to use pdf-parse');
  console.error('   Module contents:', pdfParse);
  process.exit(1);
}

// Test 4: Try to parse a simple test buffer
console.log('\n4. Testing with sample PDF...');
const fs = require('fs');

// Check if we have any PDF files in uploads
const testPdfPaths = [];
function findPdfs(dir) {
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = `${dir}/${item}`;
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        findPdfs(fullPath);
      } else if (item.toLowerCase().endsWith('.pdf')) {
        testPdfPaths.push(fullPath);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
  }
}

findPdfs('./uploads');

if (testPdfPaths.length > 0) {
  console.log(`   Found ${testPdfPaths.length} PDF(s) in uploads/`);
  console.log(`   Testing with: ${testPdfPaths[0]}`);

  (async () => {
    try {
      const dataBuffer = fs.readFileSync(testPdfPaths[0]);
      console.log(`   PDF file size: ${(dataBuffer.length / 1024 / 1024).toFixed(2)} MB`);

      console.log('   Parsing PDF...');
      const data = await pdf(dataBuffer);

      console.log(`   ✓ Success! Pages: ${data.numpages}`);
      console.log(`   Text length: ${data.text.length} characters`);
      console.log(`   First 100 chars: ${data.text.substring(0, 100).replace(/\n/g, ' ')}`);

      console.log('\n✓ All tests passed! pdf-parse is working correctly.');
    } catch (error) {
      console.error('   ✗ Error parsing PDF:', error.message);
      console.error('   Stack:', error.stack);
    }
  })();
} else {
  console.log('   No PDF files found in uploads/ directory');
  console.log('   Skipping PDF parsing test');
  console.log('\n✓ Module tests passed! Upload a PDF and process it to complete testing.');
}

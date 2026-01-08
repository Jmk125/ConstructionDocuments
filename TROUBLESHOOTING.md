# Troubleshooting pdf-parse Issues

## Error: "pdf is not a function"

This error occurs when the `pdf-parse` module isn't loading correctly. Here are steps to fix it:

### Step 1: Test Current Installation

Run the diagnostic script:
```bash
node test-pdf-parse.js
```

This will tell you exactly what's wrong with the pdf-parse module.

### Step 2: Reinstall pdf-parse

If the test fails, try reinstalling the module:

```bash
# Delete node_modules and package-lock.json
rm -rf node_modules package-lock.json

# Or on Windows:
rmdir /s /q node_modules
del package-lock.json

# Reinstall all dependencies
npm install
```

### Step 3: Alternative - Manual Reinstall of pdf-parse

If the above doesn't work, try reinstalling just pdf-parse:

```bash
npm uninstall pdf-parse
npm install pdf-parse@1.1.1
```

### Step 4: Check for Missing Dependencies

pdf-parse requires certain native modules. On Windows, you might need:

1. **Python** (for node-gyp)
2. **Visual Studio Build Tools**

Install Windows Build Tools (run as Administrator):
```bash
npm install --global --production windows-build-tools
```

### Step 5: Alternative PDF Parser

If pdf-parse continues to have issues, we can switch to `pdf2json` which has fewer native dependencies:

1. Update `package.json`:
```json
"dependencies": {
  "pdf2json": "^3.0.4"
}
```

2. Install:
```bash
npm install
```

3. I'll update the code to use pdf2json instead.

### Step 6: Verify Node Version

Make sure you're using a compatible Node.js version:
```bash
node --version
```

Recommended: Node.js 18.x or 20.x

### Common Issues on Windows

1. **Long file paths**: Make sure your project isn't in a deeply nested directory
2. **Antivirus**: Some antivirus software blocks node-gyp compilation
3. **Permissions**: Try running `npm install` as Administrator

### Still Having Issues?

Share the output of:
```bash
node test-pdf-parse.js
npm list pdf-parse
node --version
npm --version
```

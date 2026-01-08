# Troubleshooting pdf-parse Issues

## Error: "pdf is not a function"

This error occurs when you have **pdf-parse version 2.x** installed, which has a completely different API than version 1.x.

### The Solution

The Construction AI app requires **pdf-parse version 1.1.1**. Here's how to fix it:

### Step 1: Test Current Installation

Run the diagnostic script:
```bash
node test-pdf-parse.js
```

If you see "pdf-parse is not a function" and "You have version 2.x installed", continue to Step 2.

### Step 2: Install the Correct Version

**IMPORTANT:** You must install pdf-parse version 1.1.1 specifically:

```bash
# Uninstall current version
npm uninstall pdf-parse

# Install version 1.1.1
npm install pdf-parse@1.1.1

# Verify installation
node test-pdf-parse.js
```

### Step 3: Restart Your Server

After reinstalling, restart the Node.js server:

```bash
npm start
```

### Alternative: Full Reinstall

If the above doesn't work, do a complete reinstall:

```bash
# On Windows Command Prompt:
rmdir /s /q node_modules
del package-lock.json
npm install

# On Mac/Linux:
rm -rf node_modules package-lock.json
npm install
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

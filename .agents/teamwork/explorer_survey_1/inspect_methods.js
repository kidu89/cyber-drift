const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

function inspectClassMethods(className) {
    let re = new RegExp(`${className}\\s*=\\s*class[^{]*\\{([\\s\\S]*?)\\n\\};?`);
    let m = re.exec(content);
    if (m) {
        let code = m[0];
        // find method names
        let methodRegex = /([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*\{/g;
        let mm;
        let methods = [];
        while ((mm = methodRegex.exec(code)) !== null) {
            methods.push(mm[1] + '(' + mm[2] + ')');
        }
        console.log(`Methods of ${className}:`, methods);
    } else {
        console.log(`Class not matched: ${className}`);
    }
}

inspectClassMethods('sE');
inspectClassMethods('gE');
inspectClassMethods('vE'); // stunts
inspectClassMethods('W_'); // tele

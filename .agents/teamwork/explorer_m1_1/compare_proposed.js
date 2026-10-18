const fs = require('fs');

const surveyProposed = fs.readFileSync('.agents/teamwork/explorer_survey_1/proposed_server.js', 'utf8');
const original = fs.readFileSync('server.js', 'utf8');
const cleaned = original.replace(/\\`/g, '`').replace(/\\\$/g, '$');

console.log('Survey proposed length:', surveyProposed.length);
console.log('Cleaned length:', cleaned.length);

// Compare differences
if (surveyProposed === cleaned) {
    console.log('EXACT MATCH: cleaned original matches explorer_survey_1/proposed_server.js exactly!');
} else {
    console.log('Differences found:');
    const lines1 = surveyProposed.split('\n');
    const lines2 = cleaned.split('\n');
    for (let i = 0; i < Math.max(lines1.length, lines2.length); i++) {
        if (lines1[i] !== lines2[i]) {
            console.log(`Line ${i+1}:`);
            console.log(' proposed:', JSON.stringify(lines1[i]));
            console.log(' cleaned: ', JSON.stringify(lines2[i]));
        }
    }
}

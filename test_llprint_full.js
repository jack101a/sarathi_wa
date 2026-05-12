const ll = require('./src/services/llPrintService');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function run() {
    console.log('🚀 Starting Full Flow Test...');
    let session;
    try {
        session = await ll.startLLPrintFlow('1064024026', '01-01-2000', '9660930674');
        console.log('\n✅ OTP Triggered Successfully!');
        
        rl.question('👉 Please enter the OTP you received: ', async (otp) => {
            console.log(`\n📥 Submitting OTP: ${otp}...`);
            try {
                const pdfPath = await ll.submitLLPrintOTP(
                    session.context, 
                    session.page, 
                    session.profilePath, 
                    otp, 
                    '1064024026', 
                    '01-01-2000'
                );
                console.log(`\n🎉 SUCCESS! PDF saved at: ${pdfPath}`);
            } catch (err) {
                console.error('\n❌ Submit OTP Failed:', err.message);
            } finally {
                rl.close();
                process.exit(0);
            }
        });
    } catch (err) {
        console.error('\n❌ Start Flow Failed:', err.message);
        rl.close();
        process.exit(1);
    }
}

run();

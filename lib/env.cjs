'use strict';
const path = require('node:path');

// Load site environment values while allowing a missing dotenv file
function loadEnv(directory) {
    try {
        // Node parses dotenv syntax without evaluating shell code or replacing existing variables
        process.loadEnvFile(path.join(directory, '.env'));
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

module.exports = { loadEnv };

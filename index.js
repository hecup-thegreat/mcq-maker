const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, '../public')));

// Store application state
let appState = {
    questions: [],
    locks: {},
    activityLog: []
};

wss.on('connection', (ws) => {
    console.log('New client connected');

    // Send current state to new client
    ws.send(JSON.stringify({
        type: 'INITIAL_STATE',
        state: appState
    }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data.type);

            switch (data.type) {
                case 'LOCK_QUESTION':
                    if (!appState.locks[data.index] || appState.locks[data.index].clientId === data.clientId) {
                        appState.locks[data.index] = {
                            clientId: data.clientId,
                            username: data.username
                        };

                        // Log activity on server
                        const entry = {
                            timestamp: new Date().toISOString(),
                            event: 'question_locked',
                            username: data.username,
                            question_index: data.index
                        };
                        appState.activityLog.push(entry);

                        broadcast({
                            type: 'STATE_UPDATE',
                            state: appState
                        });
                    }
                    break;

                case 'UNLOCK_QUESTION':
                    if (appState.locks[data.index]?.clientId === data.clientId) {
                        delete appState.locks[data.index];

                        // Log activity on server
                        const entry = {
                            timestamp: new Date().toISOString(),
                            event: 'question_unlocked',
                            username: data.username,
                            question_index: data.index
                        };
                        appState.activityLog.push(entry);

                        broadcast({
                            type: 'STATE_UPDATE',
                            state: appState
                        });
                    }
                    break;

                case 'UPDATE_QUESTION':
                    if (appState.locks[data.index]?.clientId === data.clientId) {
                        appState.questions[data.index] = data.question;

                        // Log activity on server
                        const entry = {
                            timestamp: new Date().toISOString(),
                            event: 'question_updated',
                            username: data.username,
                            question_index: data.index,
                            field: data.field
                        };
                        appState.activityLog.push(entry);

                        broadcast({
                            type: 'STATE_UPDATE',
                            state: appState
                        });
                    }
                    break;

                case 'ADD_QUESTIONS':
                    appState.questions = data.questions;
                    appState.locks = {};

                    // Log activity on server
                    const entry = {
                        timestamp: new Date().toISOString(),
                        event: 'file_uploaded',
                        username: data.username,
                        filename: data.filename,
                        question_count: data.questions.length
                    };
                    appState.activityLog.push(entry);

                    broadcast({
                        type: 'STATE_UPDATE',
                        state: appState
                    });
                    break;

                case 'ADD_ACTIVITY':
                    appState.activityLog.push(data.entry);
                    broadcast({
                        type: 'STATE_UPDATE',
                        state: appState
                    });
                    break;

                case 'CLEAR_LOG':
                    appState.activityLog = [];
                    broadcast({
                        type: 'STATE_UPDATE',
                        state: appState
                    });
                    break;
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });
});

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
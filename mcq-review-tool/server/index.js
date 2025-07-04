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
    tabs: {
        default: {
            id: 'default',
            title: 'Default',
            questions: [],
            metadata: {
                year: '',
                type: '',
                unit: ''
            }
        }
    },
    currentTabId: 'default',
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

                        // Log activity
                        const lockEntry = {
                            timestamp: new Date().toISOString(),
                            event: 'question_locked',
                            username: data.username,
                            question_index: data.index,
                            tabId: appState.currentTabId
                        };
                        appState.activityLog.push(lockEntry);

                        broadcast({
                            type: 'STATE_UPDATE',
                            state: appState
                        });
                    }
                    break;

                case 'UNLOCK_QUESTION':
                    if (appState.locks[data.index]?.clientId === data.clientId) {
                        delete appState.locks[data.index];

                        // Log activity
                        const unlockEntry = {
                            timestamp: new Date().toISOString(),
                            event: 'question_unlocked',
                            username: data.username,
                            question_index: data.index,
                            tabId: appState.currentTabId
                        };
                        appState.activityLog.push(unlockEntry);

                        broadcast({
                            type: 'STATE_UPDATE',
                            state: appState
                        });
                    }
                    break;

                case 'UPDATE_QUESTION':
                    if (appState.locks[data.index]?.clientId === data.clientId) {
                        // Update question in current tab
                        const currentTab = appState.tabs[appState.currentTabId];
                        if (currentTab) {
                            currentTab.questions[data.index] = data.question;
                        }

                        // Log activity
                        const updateEntry = {
                            timestamp: new Date().toISOString(),
                            event: 'question_updated',
                            username: data.username,
                            question_index: data.index,
                            field: data.field,
                            tabId: appState.currentTabId
                        };
                        appState.activityLog.push(updateEntry);

                        broadcast({
                            type: 'STATE_UPDATE',
                            state: appState
                        });
                    }
                    break;

                case 'CREATE_TAB':
                    if (data.tab) {
                        appState.tabs[data.tab.id] = data.tab;

                        if (data.switchToTab) {
                            appState.currentTabId = data.tab.id;
                        }

                        // Log activity
                        const createEntry = {
                            timestamp: new Date().toISOString(),
                            event: 'new_tab_created',
                            username: data.username,
                            tabId: data.tab.id,
                            tabTitle: data.tab.title
                        };
                        appState.activityLog.push(createEntry);

                        broadcast({
                            type: 'STATE_UPDATE',
                            state: appState
                        });
                    }
                    break;

                case 'ADD_QUESTIONS':
                    if (data.tabId && appState.tabs[data.tabId]) {
                        appState.tabs[data.tabId].questions = [
                            ...appState.tabs[data.tabId].questions,
                            ...data.questions
                        ];

                        // Log activity
                        const addEntry = {
                            timestamp: new Date().toISOString(),
                            event: 'questions_added',
                            username: data.username,
                            filename: data.filename,
                            question_count: data.questions.length,
                            tabId: data.tabId
                        };
                        appState.activityLog.push(addEntry);

                        broadcast({
                            type: 'STATE_UPDATE',
                            state: appState
                        });
                    }
                    break;

                case 'SWITCH_TAB':
                    if (appState.tabs[data.tabId]) {
                        appState.currentTabId = data.tabId;

                        // Log activity
                        const switchEntry = {
                            timestamp: new Date().toISOString(),
                            event: 'tab_switched',
                            username: data.username,
                            tabId: data.tabId
                        };
                        appState.activityLog.push(switchEntry);

                        broadcast({
                            type: 'STATE_UPDATE',
                            state: appState
                        });
                    }
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
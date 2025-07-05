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
    collections: [
        {
            name: "Default",
            metadata: { year: "", type: "", unit: "" },
            questions: [],
            locks: {},
            activityLog: []
        }
    ],
    currentCollectionIndex: 0
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
                    handleLockQuestion(data);
                    break;

                case 'UNLOCK_QUESTION':
                    handleUnlockQuestion(data);
                    break;

                case 'UPDATE_QUESTION':
                    handleUpdateQuestion(data);
                    break;

                case 'ADD_QUESTIONS':
                    handleAddQuestions(data);
                    break;

                case 'CREATE_COLLECTION':
                    handleCreateCollection(data);
                    break;

                case 'DELETE_COLLECTION':
                    handleDeleteCollection(data);
                    break;

                case 'DELETE_QUESTION':
                    handleDeleteQuestion(data);
                    break;

                case 'ADD_ACTIVITY':
                    handleAddActivity(data);
                    break;

                case 'CLEAR_LOG':
                    handleClearLog(data);
                    break;
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });
});

function handleLockQuestion(data) {
    const collection = appState.collections[data.collectionIndex];
    if (!collection.locks[data.index] || collection.locks[data.index].clientId === data.clientId) {
        collection.locks[data.index] = {
            clientId: data.clientId,
            username: data.username
        };

        // Log activity
        const entry = {
            timestamp: new Date().toISOString(),
            event: 'question_locked',
            username: data.username,
            question_index: data.index
        };
        collection.activityLog.push(entry);

        broadcastState();
    }
}

function handleUnlockQuestion(data) {
    const collection = appState.collections[data.collectionIndex];
    if (collection.locks[data.index]?.clientId === data.clientId) {
        delete collection.locks[data.index];

        // Log activity
        const entry = {
            timestamp: new Date().toISOString(),
            event: 'question_unlocked',
            username: data.username,
            question_index: data.index
        };
        collection.activityLog.push(entry);

        broadcastState();
    }
}

function handleUpdateQuestion(data) {
    const collection = appState.collections[data.collectionIndex];
    if (collection.locks[data.index]?.clientId === data.clientId) {
        collection.questions[data.index] = data.question;

        // Log activity
        const entry = {
            timestamp: new Date().toISOString(),
            event: 'question_updated',
            username: data.username,
            question_index: data.index,
            field: data.field
        };
        collection.activityLog.push(entry);

        broadcastState();
    }
}

function handleDeleteQuestion(data) {
    const collection = appState.collections[data.collectionIndex];

    // Check if the question is locked by the same client
    if (collection.locks[data.index]?.clientId === data.clientId) {
        // Remove the question
        collection.questions.splice(data.index, 1);

        // Remove any locks for this question
        delete collection.locks[data.index];

        // Adjust locks for subsequent questions
        const newLocks = {};
        Object.entries(collection.locks).forEach(([key, value]) => {
            const idx = parseInt(key);
            if (idx > data.index) {
                newLocks[idx - 1] = value;
            } else if (idx < data.index) {
                newLocks[idx] = value;
            }
        });
        collection.locks = newLocks;

        // Log activity
        const entry = {
            timestamp: new Date().toISOString(),
            event: 'question_deleted',
            username: data.username,
            question_index: data.index
        };
        collection.activityLog.push(entry);

        broadcastState();
    } else {
        console.log('Question not deleted - not locked by requesting client');
    }
}

function handleAddQuestions(data) {
    const collection = appState.collections[data.collectionIndex];
    // Append new questions to existing ones
    collection.questions = [...collection.questions, ...data.questions];
    // Reset locks for this collection? Maybe not necessary, but we can keep existing locks
    // collection.locks = {};

    // Log activity
    const entry = {
        timestamp: new Date().toISOString(),
        event: 'file_uploaded',
        username: data.username,
        filename: data.filename,
        question_count: data.questions.length
    };
    collection.activityLog.push(entry);

    broadcastState();
}

function handleCreateCollection(data) {
    const collectionName = `${data.metadata.year} ${data.metadata.type} ${data.metadata.unit}`;
    const newCollection = {
        name: collectionName,
        metadata: data.metadata,
        questions: data.questions,
        locks: {},
        activityLog: []
    };

    appState.collections.push(newCollection);
    appState.currentCollectionIndex = appState.collections.length - 1;

    // Log activity
    const entry = {
        timestamp: new Date().toISOString(),
        event: 'collection_created',
        username: data.username,
        collectionName: collectionName,
        question_count: data.questions.length
    };
    newCollection.activityLog.push(entry);

    broadcastState();
}

function handleDeleteCollection(data) {
    if (appState.collections.length <= 1) {
        return; // Cannot delete the last collection
    }

    const collectionIndex = data.collectionIndex;
    const collectionName = appState.collections[collectionIndex].name;

    // Remove the collection
    appState.collections.splice(collectionIndex, 1);

    // Adjust current collection index
    if (appState.currentCollectionIndex >= collectionIndex) {
        if (appState.currentCollectionIndex === collectionIndex) {
            // If we deleted the current collection, switch to the first one
            appState.currentCollectionIndex = 0;
        } else {
            // Adjust index if it was after the deleted collection
            appState.currentCollectionIndex--;
        }
    }

    // Log activity
    const entry = {
        timestamp: new Date().toISOString(),
        event: 'collection_deleted',
        username: data.username,
        collectionName: collectionName
    };
    appState.collections[appState.currentCollectionIndex].activityLog.push(entry);

    broadcastState();
}

function handleAddActivity(data) {
    const collection = appState.collections[data.collectionIndex];
    collection.activityLog.push(data.entry);
    broadcastState();
}

function handleClearLog(data) {
    const collection = appState.collections[data.collectionIndex];
    collection.activityLog = [];
    broadcastState();
}

function broadcastState() {
    broadcast({
        type: 'STATE_UPDATE',
        state: appState
    });
}

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
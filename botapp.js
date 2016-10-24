/* Uses the slack button feature to offer a real time bot to multiple teams */
var Botkit = require('botkit');
var moment = require('moment');
var plotly = require('plotly')(process.env.username, process.env.plotlyApi);
var fs = require('fs');
var pollCase = require('./pollCase.js');
var userCase = require('./userCase.js');
var userAction = require('./userAction.js');
var userCmd = require('./userCmd.js');

const util = require('util');

var mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/botapp';
var mongoStorage = require('botkit-storage-mongo')({ mongoUri: mongoUri });
var port = process.env.PORT || 3000;

if (!process.env.clientId || !process.env.clientSecret || !port) {
    console.log('Error: Specify clientId clientSecret and port in environment');
    process.exit(1);
}


var controller = Botkit.slackbot({
    interactive_replies: true, // tells botkit to send button clicks into conversations
    storage: mongoStorage,
}).configureSlackApp({
    clientId: process.env.clientId,
    clientSecret: process.env.clientSecret,
    scopes: ['bot', 'command'],
});

controller.setupWebserver(port, function(err, webserver) {
    controller.createWebhookEndpoints(controller.webserver);
    controller.createHomepageEndpoint(controller.webserver);

    controller.createOauthEndpoints(controller.webserver, function(err, req, res) {
        if (err) {
            res.status(500).send('ERROR: ' + err);
        } else {
            res.send('Success!');
        }
    });

});


// just a simple way to make sure we don't
// connect to the RTM twice for the same team
var _bots = {};

function trackBot(bot) {
    _bots[bot.config.token] = bot;
}

// After users click any button in the message sent by bot, run the function below
controller.on('interactive_message_callback', function(bot, message) {

    var ids = message.callback_id.split(/\-/);

    if (ids[0] == 'go_vote') {
        var choice = message.actions[0].name;
        var case_id = ids[1];
        var user_id = ids[2];

        userAction.goVoteCase(controller, bot, message, case_id, user_id, choice);
    }

    if (ids[0] == 'join_case') {
        var case_id = ids[1];
        var user_id = ids[2];

        userAction.joinCase(controller, bot, message, case_id, user_id);
    }

});


controller.on('slash_command', function(bot, message) {

    var user_input = message.text.split(/\ /);

    if (message.command == '/propose') {

        userCmd.propose(controller, bot, message);
        
    } else if (message.command == '/vote') {

        var case_id = user_input[0];
        userCmd.vote(controller, bot, message, case_id);

    } else if (message.command == '/result') {

        var case_id = user_input[0];
        var data = {
            text: '(只有你會看到此項訊息)',
            attachments: [{
                fallback: 'The result of #' + case_id,
                title: '',
                text: '',
                fields: [],
                color: '#F35A00'
            }, {
                fallback: 'Data Visualiztion of #' + case_id,
                title: '',
                text: '',
                color: '#F35A00'
            }]
        }

        userCmd.result(controller, bot, message, case_id, data, plotly);

    } else if (message.command == '/unvote') {

        var data = {
            text: ['(只有你會看到此項訊息)'],
            attachments: [{
                fallback: '以下是你已經參加，但還未投票的案件編號',
                title: '以下是你已經參加，但還未投票的案件編號',
                text: '使用 `/vote 編號` 指令開始進行\n',
                color: 'warning'
            }],

        };

        userCmd.unvote(controller, bot, message, data);

    } else if (message.command == '/votehelp') {
        userCmd.help(bot, message);
    }
});




/* Polling to see whether there is a case almost due */
function polling(bot) {
    var current_time = parseInt(moment().format('X')) + 28800;

    controller.storage.teams.get(bot.config.id, function(err, team) {

        if (team.hasOwnProperty('polling_case')) {
            var polling_case = team.polling_case;
            for (var i in polling_case) {
                if ((polling_case[i].details.due_date - current_time) >= 3600 && (polling_case[i].details.due_date - current_time) < 3660) {

                    var broadcast_im = function broadcast(users_list) {
                        for (var i = 0; i < users_list.length; i++) {
                            bot.startPrivateConversation({ user: users_list[i] }, function(err, convo) {
                                if (err) {
                                    console.log(err);
                                } else {
                                    convo.say(':bell:編號#' + polling_case[i].case_id + '將在一個小時後截止!');
                                }
                            });
                        }
                    }

                    userCase.getUserList(bot, function(users_list) {
                        broadcast_im(users_list);
                    });

                }
            }
        }
    });
}

/////////////////////////////////////////////////////////////////////////////////////////////////////
controller.storage.teams.all(function(err, teams) {

    if (err) {
        throw new Error(err);
    }

    // connect all teams with bots up to slack!
    for (var t in teams) {
        if (teams[t].bot) {
            controller.spawn(teams[t]).startRTM(function(err, bot) {
                if (err) {
                    console.log('Error connecting bot to Slack:', err);
                } else {
                    trackBot(bot);
                }
            });
        }
    }

});

controller.on('create_bot', function(bot, config) {

    if (_bots[bot.config.token]) {
        // already online! do nothing.
    } else {
        bot.startRTM(function(err) {

            if (!err) {
                trackBot(bot);
            }

            bot.startPrivateConversation({ user: config.createdBy }, function(err, convo) {
                if (err) {
                    console.log(err);
                } else {
                    convo.say('I am a bot that has just joined your team');
                    convo.say('You must now /invite me to a channel so that I can be of use!');
                }
            });

        });
    }

});


// Handle events related to the websocket connection to Slack
controller.on('rtm_open', function(bot) {
    console.log('** The RTM api just connected!');
    setInterval(polling, 60000, bot);
});

controller.on('rtm_close', function(bot) {
    console.log('** The RTM api just closed');
    // you may want to attempt to re-open
});
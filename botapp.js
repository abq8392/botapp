/* Uses the slack button feature to offer a real time bot to multiple teams */
var Botkit = require('botkit');
var async = require('asyncawait/async');
var await = require('asyncawait/await');
//var async = require('async');
//var Promise = require('promise');

var mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/botapp';
var mongoStorage = require('botkit-storage-mongo')({ mongoUri: mongoUri });
var port = process.env.port || "3000";

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

// Any members in group can propose the polling case
function proposeCase(bot, case_detail) {
    //console.log('Function proposeCase: ' + JSON.stringify(case_detail));

    // Get other polling_case from database
    controller.storage.teams.get('T1PG5SWSC', function(err, team) {
        /* Create a polling_case list or add new object to list directly */
        if (!team.hasOwnProperty('polling_case'))
            team['polling_case'] = [{}];

        team.polling_case.push({
            case_id: (team.polling_case.length) + 1,
            people_count: 0,
            joined_users: [],
            tickets: [],
            people_goal: 2,
            over_goal: false,
            details: case_detail
        })

        controller.storage.teams.save(team);

        // Get users_list
        var users_list = [];

        function get_list(callback) {
            bot.api.users.list({ token: bot.config.token }, function(err, res) {

                if (err) {
                    console.log(err);
                } else {

                    for (var i = 0; i < res.members.length; i++) {
                        var userId = res.members[i].id;
                        if (!(res.members[i].is_bot) && (userId != 'U1TN782GJ') && (userId != 'USLACKBOT')) {
                            users_list.push(userId);
                        }
                    }
                }
                callback && callback();
            });
        }

        var broadcast_im = function broadcast() {
            for (var i = 0; i < users_list.length; i++) {
                bot.startPrivateConversation({ user: users_list[i] }, function(err, convo) {
                    if (err) {
                        console.log(err);
                    } else {

                        var data = {
                            attachments: [{
                                fallback: team.polling_case[team.polling_case.length - 1].details.title,
                                title: team.polling_case[team.polling_case.length - 1].details.title,
                                text: team.polling_case[team.polling_case.length - 1].details.description,
                                callback_id: 'join_case' + '-' + team.polling_case[team.polling_case.length - 1].case_id + '-' + convo.source_message.user,
                                attachment_type: 'default',
                                actions: [{
                                    'name': 'join',
                                    'text': 'Join',
                                    'value': 'join',
                                    'type': 'button',
                                }, {
                                    'name': 'no',
                                    'text': 'No',
                                    'value': 'no',
                                    'type': 'button',
                                }],
                                pretext: '想要參與編號#' + team.polling_case[team.polling_case.length - 1].case_id + '投票嗎?'
                            }]
                        }
                        convo.say(data);
                    }
                });
            }
        }
        get_list(broadcast_im);
    });
}

function createOption(case_id, message_user, callback) {
    var case_data;
    case_data = controller.storage.teams.get('T1PG5SWSC', function(err, team) {
        var polling_case = team.polling_case[case_id - 1];
        var data = {
            text: '(只有你會看到此項訊息)',
            attachments: [{
                fallback: polling_case.details.title,
                title: polling_case.details.title,
                text: polling_case.details.description,
                callback_id: 'go_vote' + '-' + case_id + '-' + message_user,
                color: '#3AA3E3',
                attachment_type: 'default',
                actions: []
            }]
        };

        for (var i = 0; i < polling_case.details.option.length; i++) {
            data.attachments[0].actions.push({
                'name': polling_case.details.option[i].text,
                'text': polling_case.details.option[i].text,
                'value': (i + 1),
                'type': 'button',
            });
        }
        callback(data);
    });
}

// Broadcast when poll starting!
function broadcastPrivate(bot, caseid, users) {
    for (var i = 0; i < users.length; i++) {
        bot.startPrivateConversation({ user: users[i] }, function(err, convo) {
            convo.say('#' + caseid + '投票案已經開始。如果你想要開始投票，使用 `/vote ' + caseid + ' ticket_number`指令開始進行');
        });
    }
}

// Update people count, joined_user list and generate unique ticket number
function addTeamCase(bot, user_id, case_id, callback) {
    var unique_ticket = 0;
    controller.storage.teams.get('T1PG5SWSC', function(err, team) {
        var polling_case;
        for (var i = 0; i < team.polling_case.length; i++) {
            if (case_id == team.polling_case[i].case_id) {
                polling_case = team.polling_case[i];
                break;
            }
        }

        // Update for people count & joined user list
        polling_case.people_count++;
        polling_case.joined_users.push(user_id);

        if (polling_case.people_count == 2) {

            // Acheive the goal of people number
            polling_case.over_goal = true;
            broadcastPrivate(bot, polling_case.case_id, polling_case.joined_users);

        } else if (polling_case.people_count > 2) {

            // Already over goal
            broadcastPrivate(bot, polling_case.case_id, [user_id]);

        } else {
            bot.startPrivateConversation({ user: user_id }, function(err, convo) {
                convo.say('到達人數門檻時，將會再度通知您！');
            });
        }


        // Generate random number from 1000 to 9999
        do {
            unique_ticket = Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000;
        } while (polling_case.tickets.indexOf(unique_ticket) != -1); // The ticket has existed.

        polling_case.tickets.push(unique_ticket);
        controller.storage.teams.save(team);

        callback(unique_ticket);
    });
}

// Add case to user database
function addUserCase(join_user, pass_case, unique_ticket, callback) {

    controller.storage.users.get(join_user, function(err, user) {
        if (!user) {
            user = {
                id: join_user,
                join_case: []
            }
        } else if (!user.hasOwnProperty('join_case')) {
            user['join_case'] = [];
        }

        user.join_case.push({
            case_id: pass_case,
            done: false,
            ticket_num: unique_ticket,
            option: ""
        });
        controller.storage.users.save(user);
        callback();
    });
}

// Record whether user vote or not, and his/her choice
function updateUserCase(join_user, pass_case, choice) {
    controller.storage.users.get(join_user, function(err, user) {
        for (var i = 0; i < user.join_case.length; i++) {
            if (pass_case == user.join_case[i].case_id) {
                user.join_case[i].done = true;
                user.join_case[i].option = choice;
            }
        }
        controller.storage.users.save(user);
    });
}

// After users click any button in the message sent by bot, run the function below
controller.on('interactive_message_callback', function(bot, message) {

    var ids = message.callback_id.split(/\-/);

    if (ids[0] == 'go_vote') {
        var choice = message.actions[0].name;
        var case_id = ids[1];
        var user_id = ids[2];

        bot.replyInteractive(message, ':white_check_mark: Thank you! You have chosen ' + choice);

        controller.storage.teams.get('T1PG5SWSC', function(err, team) {
            var option_order = message.actions[0].value;
            var polling_case = team.polling_case;

            for (var i = 0; i < polling_case.length; i++) {
                if (case_id == polling_case[i].case_id) {
                    polling_case[i].details.option[option_order - 1].count++;
                    updateUserCase(user_id, case_id, choice);
                }
            }
            controller.storage.teams.save(team);
        });
    }

    if (ids[0] == 'join_case') {
        var case_id = ids[1];
        var user_id = ids[2];

        //console.log('case id: ' + case_id + '  user_id: ' + user_id);
        controller.storage.teams.get('T1PG5SWSC', function(err, team) {

            //To see join the clicking user or not && whether the people number acheive
            var polling_case = team.polling_case;
            if (message.actions[0].value == 'join') {

                for (var i = 0; i < polling_case.length; i++) {
                    if (case_id == polling_case[i].case_id) {

                        addTeamCase(bot, user_id, case_id, function(unique_ticket) {
                            addUserCase(user_id, case_id, unique_ticket, function() {
                                bot.replyInteractive(message, ':white_check_mark: 你已報名參與此投票，票卷號碼為：' + unique_ticket);
                            });
                        });

                    }
                }

            } else if (message.actions[0].value == 'no') {
                bot.replyInteractive(message, '你將不會參與此次投票:relieved:');
            }

            controller.storage.teams.save(team);

        });
    }

});



/*
function proposeDone(detail){
    return new Promise(function(resolve, reject) {
        console.log("In propose done: " + JSON.stringify(detail));
        resolve(detail);
    });
    
}

function hearForPropose() {
    bot.replyPrivate(message, 'Hello! 歡迎使用提案功能，你可以隨時輸入 `exit!` 來離開提案模式\n請先輸入你的「提案標題」:');
    controller.hears('exit!', function(bot, message) {
        bot.reply(message, '你已經放棄此提案，剛剛所填寫的所有資訊將不被保存');
    });


}*/

/*
function proposeTitle(callback) {
    controller.on('direct_message', function(bot, message) {
        console.log('Title: ' + JSON.stringify(message));
        //callback(null, message.text);
        callback(null);
    });
}*/
/*
function proposeDesc() {

}

function proposeChoice() {

}

function convoProposeTest(bot, user_id) {
    async.series([
            function(callback) {
                controller.on('direct_message', function(bot, message) {
                    console.log('Title: ' + JSON.stringify(message));
                    bot.reply(message,'請輸入「提案描述」');
                    callback(null, message.text);
                });
                //callback(null, 'one');
            },
            function(callback) {
                controller.on('direct_message', function(bot, message) {
                    console.log('Title: ' + JSON.stringify(message));
                    bot.reply(message,'請輸入「選項」，每個選項請用空格隔開');
                    callback(null, message.text);
                });
                //callback(null, 'two');
            },
            function(callback) {
                callback(null, 'three');
            }
        ],
        function(err, results) {
            if (err) {
                console.log('Error occured in convoProposeTest\n' + err);
            } else {
                console.log(results);
            }
        }
    );

}
*/
/*
function convoPropose(bot, user_id) {
    async.series([
            function(callback) {
                // Hint: Polling case title
                console.log('I am in polling case title (Hint)');
                bot.startPrivateConversation({ user: user_id }, function(err, convo) {
                    if (err) {
                        console.log(err);
                        callback(err);
                    } else {
                        convo.say('請輸入「提案標題」:');
                        callback(null);
                    }
                });
            },
            function(callback) {
                // Hear: polling case title
                console.log('I am in polling case title (Input)');
                controller.on('direct_message', function(bot, message) {
                    console.log('Title: ' + JSON.stringify(message));
                    //callback(null, message.text);
                    callback(null);
                });
            },
            function(callback) {
                // Hint: Polling case description
                console.log('I am in polling case description (Hint)');
                bot.startPrivateConversation({ user: user_id }, function(err, convo) {
                    if (err) {
                        console.log(err);
                        callback(err);
                    } else {
                        convo.say('請輸入「提案描述」:');
                        //callback(null);
                    }
                });
            },
            function(callback) {
                // Hear: Polling case description
                console.log('I am in polling case description (Input)');
                controller.on('direct_message', function(bot, message) {
                    console.log('Description: ' + JSON.stringify(message));
                    //callback(null, message.text);
                    //callback(null);
                });
            },
            function(callback) {
                // Hint: Polling case choice setting
                console.log('I am in polling case choice setting (Hint)');
                bot.startPrivateConversation({ user: user_id }, function(err, convo) {
                    if (err) {
                        console.log(err);
                        callback(err);
                    } else {
                        convo.say('請輸入「投票選項」，選項間請用空格隔開:');
                        //callback(null);
                    }
                });
            },
            function(callback) {
                // Hear: Polling case choice setting
                console.log('I am in polling case choice setting (Input)');
                controller.on('direct_message', function(bot, message) {
                    console.log('In proposeTitle: ' + JSON.stringify(message));
                    //callback(null, message.text);
                    //callback(null);
                });
            }
        ],
        //optional callback
        function(err, results) {
            if (err) {
                console.log('Async callback error:' + err);
            } else {
                console.log('Async result is:' + results);
            }

        });
}
*/




controller.on('slash_command', function(bot, message) {

    var user_input = message.text.split(/\ /);

    if (message.command == '/propose') {

        // Use conversational way to create your poll case.
        if (message.channel_id[0] != 'D') {
            bot.replyPrivate(message, '請在私訊頻道(Direct messages)使用這個功能喔！');
        } else {
            /*
            var input = '';
            console.log("message in slash_command: " + JSON.stringify(message));

            proposeTitle().then(function (){
                return proposeDone(detail);
            }).then(function(detail){
                console.log(detail);
            });*/

            //bot.replyPrivate(message, 'Hello! 歡迎使用提案功能，你可以隨時輸入 `exit!` 來離開提案模式\n請輸入「提案標題」:');
            //convoPropose(bot, message.user);

            //convoProposeTest();

            // Hint: /propose "title" "description" "option1" "option2"
            
            var detail = {
                title: user_input[0],
                description: user_input[1],
                option: []
            };

            for (var i = 2; i < user_input.length; i++) {
                detail.option.push({ text: user_input[i], count: 0 });
            }
            proposeCase(bot, detail);

        }


    } else if (message.command == '/vote') {

        var case_id = user_input[0];
        var input_ticket = user_input[1];
        var quali_case = true;
        //var ticket = user_input[1];

        // Handle the exception of poll case
        var check_case = function checkCase(callback) {
            controller.storage.teams.get('T1PG5SWSC', function(err, team) {
                for (var i = 0; i < team.polling_case.length; i++) {
                    if (i == team.polling_case.length) {
                        //sendVote('caseNotExist');
                        // The case may not exist.
                        quali_case = false;
                        break;
                    } else if (case_id == team.polling_case[i].case_id) {
                        if (!team.polling_case[i].over_goal) {
                            sendVote('notOpen');
                            quali_case = false;
                            break;
                        }
                    }
                }
                callback && callback();
            });
        }

        // Handle the exception of user case
        var check_user = function checkUser() {
            controller.storage.users.get(message.user, function(err, user) {
                if (quali_case) {
                    if (!user.hasOwnProperty('join_case')) {
                        sendVote('notAtAll');
                    } else {

                        for (var i = 0; i < user.join_case.length; i++) {
                            if (case_id == user.join_case[i].case_id) {
                                if (input_ticket != user.join_case[i].ticket_num) {
                                    sendVote('pwdWrong');
                                    break;
                                }
                                if (!user.join_case[i].done) {
                                    sendVote();
                                } else {
                                    sendVote('hasDone');
                                }
                                break;
                            } else if (i == user.join_case.length - 1) {
                                sendVote('notJoin');
                            }
                        }

                    }
                }
            });
        };

        check_case(check_user); //First checkl poll case, then check user
        function sendVote(condition) {
            switch (condition) {
                case 'pwdWrong':
                    bot.replyPrivate(message, 'Sorry! 票卷號碼錯誤，請重新輸入');
                    break;
                case 'notAtAll':
                    bot.replyPrivate(message, 'Sorry! 你沒有參與任何投票案');
                    break;
                case 'hasDone':
                    bot.replyPrivate(message, '你已經投過票囉!');
                    break;
                case 'notJoin':
                    bot.replyPrivate(message, 'Sorry! 你沒有參與此投票案');
                    break;
                case 'notOpen':
                    bot.replyPrivate(message, 'Oops! 還沒有到達投票的人數門檻喔:slightly_frowning_face:');
                    break;
                case 'caseNotExist':
                    bot.replyPrivate(message, '此投票案不存在');
                    break;
                default:
                    createOption(case_id, message.user, function(data) {
                        bot.replyPrivate(message, data);
                    });
                    break;
            }

        }

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
            }]
        }

        controller.storage.teams.get('T1PG5SWSC', function(err, team) {
            var polling_case = team.polling_case;
            for (var i = 0; i < polling_case.length; i++) {
                if (case_id == polling_case[i].case_id) {

                    data.attachments[0].title = '#' + case_id + '結果：' + polling_case[i].details.title;
                    data.attachments[0].text = polling_case[i].details.description;

                    for (var j = 0; j < polling_case[i].details.option.length; j++) {
                        data.attachments[0].fields.push({
                            title: polling_case[i].details.option[j].text,
                            value: polling_case[i].details.option[j].count + '票',
                            short: true
                        });
                    }
                    bot.replyPrivate(message, data);
                    break;
                }
            }
        });
    } else if (message.command == '/unvote') {
        controller.storage.users.get(message.user, function(err, user) {
            var unvote_case = [];
            var data = {
                text: ['(只有你會看到此項訊息)'],
                attachments: [{
                    fallback: '以下是你已經參加，但還未投票的案件編號',
                    title: '以下是你已經參加，但還未投票的案件編號',
                    text: '使用 `/vote 編號` 指令開始進行\n',
                    color: 'warning'
                }],

            };

            for (var i = 0; i < user.join_case.length; i++) {
                if (user.join_case[i].done == false) {
                    unvote_case.push('#' + user.join_case[i].case_id + ' ');
                    //data.attachments[0].text.concat("#",user.join_case[i].case_id, ",");
                }
            }
            data.attachments[0].text += unvote_case.join();
            console.log(JSON.stringify(data));
            bot.replyPrivate(message, data);
        })

    } else if (message.command == '/votehelp') {
        var helptext = require('./helptext');
        bot.replyPrivate(message, helptext);
    }
});


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
});

controller.on('rtm_close', function(bot) {
    console.log('** The RTM api just closed');
    // you may want to attempt to re-open
});

/* Uses the slack button feature to offer a real time bot to multiple teams */
var Botkit = require('botkit');

var mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/botapp';
var mongoStorage = require('botkit-storage-mongo')({ mongoUri: mongoUri });
var port = process.env.PORT || 5000;

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

// For type: 'poll'
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

// For type 'input_number'
function askNumber(bot, message, case_id, message_user, callback) {



    controller.storage.teams.get('T1PG5SWSC', function(err, team) {
        var polling_case;
        for (var i = 0; i < team.polling_case.length; i++) {
            if (case_id == team.polling_case[i].case_id) {
                polling_case = team.polling_case[i];
                break;
            }
        }

        var data = {
            text: '(只有你會看到此項訊息)',
            attachments: [{
                fallback: polling_case.details.title,
                title: polling_case.details.title,
                text: polling_case.details.description,
                color: '#3AA3E3',
                attachment_type: 'default',
            }]
        };

        askUser = function(response, convo) {
            convo.say(data);
            convo.ask('請您輸入數字：', function(response, convo) {
                convo.say('已收到您的回應，謝謝您的參與!');
                convo.next();
            });

            convo.on('end', function(convo) {
                var unique_ticket;

                if (convo.status == 'completed') {
                    var res = convo.extractResponses();
                    var choice = Number(res['請您輸入數字：']);
                    polling_case.details.option.push(choice);

                    do {
                        unique_ticket = Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000;
                    } while (polling_case.tickets.indexOf(unique_ticket) != -1); // The ticket has existed.

                    polling_case.tickets.push(unique_ticket);

                    controller.storage.teams.save(team);
                    callback(choice, unique_ticket);
                }
            });
        }
        bot.startConversation(message, askUser);
    });
}

// Broadcast when poll starting!
function broadcastPrivate(bot, caseid, users) {
    for (var i = 0; i < users.length; i++) {
        bot.startPrivateConversation({ user: users[i] }, function(err, convo) {
            convo.say('#' + caseid + '投票案已經開始。如果你想要開始投票，使用 `/vote ' + caseid + '`指令開始進行');
        });
    }
}

// Update people count, joined_user list and generate unique ticket number
function addTeamCase(bot, user_id, case_id) {
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


        if (polling_case.people_count == polling_case.details.people_goal) {

            // Acheive the goal of people number
            polling_case.details.over_goal = true;
            broadcastPrivate(bot, polling_case.case_id, polling_case.joined_users);

        } else if (polling_case.people_count > polling_case.details.people_goal) {

            // Already over goal
            broadcastPrivate(bot, polling_case.case_id, [user_id]);

        } else {
            bot.startPrivateConversation({ user: user_id }, function(err, convo) {
                convo.say('到達人數門檻時，將會再度通知您！');
            });
        }
        controller.storage.teams.save(team);
    });
}

// Add case to user database
function addUserCase(join_user, pass_case) {
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
            ticket_num: 0,
            option: ""
        });
        controller.storage.users.save(user);
    });
}

// Record whether user vote or not, and his/her choice
// Add unique ticket number
function updateUserCase(join_user, pass_case, choice, unique_ticket) {
    controller.storage.users.get(join_user, function(err, user) {
        for (var i = 0; i < user.join_case.length; i++) {
            if (pass_case == user.join_case[i].case_id) {
                user.join_case[i].done = true;
                user.join_case[i].option = choice;
                user.join_case[i].ticket_num = unique_ticket;
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

        controller.storage.teams.get('T1PG5SWSC', function(err, team) {
            var option_order = message.actions[0].value;
            var polling_case = team.polling_case;
            var case_type;
            var unique_ticket = 0;

            for (var i = 0; i < polling_case.length; i++) {
                if (case_id == polling_case[i].case_id) {

                    if (polling_case[i].details.type == 'poll') {
                        polling_case[i].details.option[option_order - 1].count++;
                    }

                    // Generate unique random number from 1000 to 9999
                    do {
                        unique_ticket = Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000;
                    } while (polling_case[i].tickets.indexOf(unique_ticket) != -1); // The ticket has existed.

                    polling_case[i].tickets.push(unique_ticket);
                    updateUserCase(user_id, case_id, choice, unique_ticket);
                    bot.replyInteractive(message, ':white_check_mark: Thank you! You have chosen ' + choice +
                        '\n票卷號碼為：' + unique_ticket);
                    break;
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

                        addTeamCase(bot, user_id, case_id);
                        addUserCase(user_id, case_id);
                        bot.replyInteractive(message, ':white_check_mark: 你已報名參與此投票');

                    }
                }

            } else if (message.actions[0].value == 'no') {
                bot.replyInteractive(message, '你將不會參與此次投票:relieved:');
            }

            controller.storage.teams.save(team);

        });
    }

});


controller.on('slash_command', function(bot, message) {

    var user_input = message.text.split(/\ /);

    if (message.command == '/propose') {

        // Use conversational way to create your poll case.
        if (message.channel_id[0] != 'D') {
            bot.replyPrivate(message, '請在私訊頻道(Direct messages)使用這個功能喔！');
        } else {

            bot.replyPrivate(message, 'Hello! 歡迎使用提案功能，你可以隨時輸入 `exit!` 來離開提案模式');

            var detail = {
                title: "",
                description: "",
                type: "",
                people_goal: 0,
                over_goal: false,
                option: []
            };

            askTitle = function(response, convo) {
                convo.ask('請輸入提案標題:', function(response, convo) {
                    convo.say('OK, your title is 「' + response.text + '」');
                    askDesc(response, convo);
                    convo.next();
                });
            }
            askDesc = function(response, convo) {
                convo.ask('請輸入提案描述:', function(response, convo) {
                    convo.say('Got your description: ' + response.text);
                    askPeopleGoal(response, convo);
                    convo.next();
                });
            }
            askPeopleGoal = function(response, convo) {
                convo.ask('請設定人數門檻(請輸入數字，若不設立請輸入0): ', function(response, convo) {
                    var res = convo.extractResponses();
                    convo.say('OK! 人數門檻為: ' + response.text);

                    if (res['請設定人數門檻(請輸入數字，若不設立請輸入0): '] != '0') {
                        detail.people_goal = Number(res['請設定人數門檻(請輸入數字，若不設立請輸入0): ']);
                    } else {
                        detail.people_goal = 0;
                        detail.over_goal = true;
                    }

                    askType(response, convo);
                    convo.next();
                });
            }
            askType = function(response, convo) {
                convo.ask('A. 輸入固定選項，B. 成員自由輸入數字', function(response, convo) {
                    var res = convo.extractResponses();
                    convo.say('OK! 你選擇了' + response.text);

                    if (res['A. 輸入固定選項，B. 成員自由輸入數字'] == 'A') {
                        detail.type = 'poll';
                    } else if (res['A. 輸入固定選項，B. 成員自由輸入數字'] == 'B') {
                        detail.type = 'input_number';
                    }
                    askOpinion(response, convo);
                    convo.next();
                });
            }
            askOpinion = function(response, convo) {
                var res = convo.extractResponses(response);
                if (detail.type == 'poll') {
                    convo.ask('請輸入投票選項，每個選項請用空格隔開：', function(response, convo) {
                        convo.say('Great!');
                        //askForSure(response, convo);
                        convo.next();
                    });
                }

                convo.on('end', function(convo) {
                    if (convo.status == 'completed') {
                        var res = convo.extractResponses();
                        var choice = '';

                        detail.title = res['請輸入提案標題:'];
                        detail.description = res['請輸入提案描述:'];

                        if (detail.type == 'poll') {
                            choice = res['請輸入投票選項，每個選項請用空格隔開：'].split(/\ /);
                            for (var i = 0; i < choice.length; i++) {
                                detail.option.push({ text: choice[i], count: 0 });
                            }
                        }
                        proposeCase(bot, detail);
                    }
                });
            }


            bot.startConversation(message, askTitle);
        }


    } else if (message.command == '/vote') {

        var case_id = user_input[0];
        var quali_case = true;
        var case_type = '';


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

                        case_type = team.polling_case[i].details.type;

                        if (!team.polling_case[i].details.over_goal) {
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
                    if (case_type == 'poll') {
                        createOption(case_id, message.user, function(data) {
                            bot.replyPrivate(message, data);
                        });
                    } else if (case_type == 'input_number') {
                        askNumber(bot, message, case_id, message.user, function(choice, unique_ticket) {
                            updateUserCase(message.user, case_id, choice, unique_ticket);
                        });
                    }
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

                    // For type = poll
                    if (polling_case[i].details.type == 'poll') {
                        for (var j = 0; j < polling_case[i].details.option.length; j++) {
                            data.attachments[0].fields.push({
                                title: polling_case[i].details.option[j].text,
                                value: polling_case[i].details.option[j].count + '票',
                                short: true
                            });
                        }
                    } else if (polling_case[i].details.type == 'input_number') {
                        //For type = input_number
                        var sum = 0;
                        var length = polling_case[i].details.option.length;

                        for (var j = 0; j < length; j++) {
                            sum += polling_case[i].details.option[j];
                        }

                        data.attachments[0].fields.push({
                            title: '平均',
                            value: sum / length,
                            short: true
                        }, {
                            title: '參與人數',
                            value: length,
                            short: true
                        }, {
                            title: '最大值',
                            value: Math.max.apply(null, polling_case[i].details.option),
                            short: true
                        }, {
                            title: '最小值',
                            value: Math.min.apply(null, polling_case[i].details.option),
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

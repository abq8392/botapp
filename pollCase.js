var Botkit = require('botkit');
var userCase = require('./userCase.js');

module.exports = {
    // Any members in group can propose the polling case
    addCase: function(controller, bot, case_detail) {
        // Get other polling_case from database
        controller.storage.teams.get(bot.config.id, function(err, team) {
            /* Create a polling_case list or add new object to list directly */
            if (!team.hasOwnProperty('polling_case'))
                team['polling_case'] = [];

            team.polling_case.push({
                case_id: (team.polling_case.length) + 1,
                people_count: 0,
                joined_users: [],
                tickets: [],
                details: case_detail
            })

            controller.storage.teams.save(team);

            var broadcast_im = function broadcast(users_list) {
                for (var i in users_list) {
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

            userCase.getUserList(bot, function(users_list) {
                broadcast_im(users_list);
            });
        });
    },

    // Update people count, joined_user list and generate unique ticket number
    updateCase: function(controller, bot, user_id, case_id) {
        controller.storage.teams.get(bot.config.id, function(err, team) {
            var polling_case;
            for (var i in team.polling_case) {
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
                // Broadcast when poll starting!
                //broadcastPrivate(bot, polling_case.case_id, [user_id]);
                var u_id = [user_id];
                for (var i in u_id) {
                    bot.startPrivateConversation({ user: u_id[i] }, function(err, convo) {
                        if (err) {
                            console.log(err);
                        } else {
                            convo.say('#' + polling_case.case_id + '投票案已經開始。如果你想要開始投票，使用 `/vote ' + polling_case.case_id + '`指令開始進行');
                        }
                    });
                }

            } else {
                bot.startPrivateConversation({ user: user_id }, function(err, convo) {
                    if (err) {
                        console.log(err);
                    } else {
                        convo.say('到達人數門檻時，將會再度通知您！');
                    }
                });
            }
            controller.storage.teams.save(team);
        });
    },

    //For Case Type = 'poll'
    createOption: function(controller, case_id, team_id, message_user, callback) {
        controller.storage.teams.get(team_id, function(err, team) {
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

            for (var i in polling_case.details.option) {
                data.attachments[0].actions.push({
                    'name': polling_case.details.option[i].text,
                    'text': polling_case.details.option[i].text,
                    'value': parseInt(i),
                    'type': 'button',
                });
            }
            callback(data);
        });
    },

    // For Case Type = 'input_number'
    askNumber: function(controller, bot, message, case_id, message_user, callback) {
        controller.storage.teams.get(bot.config.id, function(err, team) {
            var polling_case;
            for (var i in team.polling_case) {
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
}
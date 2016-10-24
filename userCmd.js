var Botkit = require('botkit');
var moment = require('moment');
var pollCase = require('./pollCase.js');
var userCase = require('./userCase.js');
const util = require('util');

function plot_on_result(plotly, visual_data, layout, callback) {
    plotly.plot(visual_data, layout, function(err, msg) {
        if (err) return console.log(err);
        callback(msg.url);

        /*
        var id = msg.url.split(/\//);
        plotly.getFigure('anon.poll.bot', id[id.length - 1], function(err, figure) {
            if (err) return console.log(err);
            //return console.log(figure);

            var img_opts = {
                format: 'png',
                width: 1000,
                height: 500
            };

            plotly.getImage(figure, img_opts, function(err, img_stream) {
                if (err) return console.log(err);

                var img_name = id[id.length - 1] + '.png'
                var fileStream = fs.createWriteStream(img_name);
                img_stream.pipe(fileStream);
            });
        });*/
    });
}

module.exports = {

    // Coomand: '/propose' ; Use conversational way to create case
    propose: function(controller, bot, message) {
        console.log(util.inspect(message));
        if (message.channel_id[0] != 'D') {
            bot.replyPrivate(message, '請在私訊頻道(Direct messages)使用這個功能喔！');
        } else {

            bot.replyPrivate(message, 'Hello! 歡迎使用提案功能，你可以隨時輸入 `exit!` 來離開提案模式');

            var detail = {
                title: "",
                description: "",
                start_date: "",
                due_date: "",
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
                    askDueDate(response, convo);
                    convo.next();
                });
            }
            askDueDate = function(response, convo) {
                convo.ask('請輸入結束日期及時間： (格式：2016-08-31 10:30)', function(response, convo) {
                    var res = convo.extractResponses();
                    var get_date = res['請輸入結束日期及時間： (格式：2016-08-31 10:30)']; // The string of date
                    convo.say('結束時間為:' + get_date);
                    //detail.due_date = moment(get_date);
                    detail.due_date = moment(get_date).unix() + 28800;

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

                    if (res['A. 輸入固定選項，B. 成員自由輸入數字'] == ('A' || 'a')) {
                        detail.type = 'poll';
                    } else if (res['A. 輸入固定選項，B. 成員自由輸入數字'] == ('B' || 'b')) {
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
                        detail.start_date = parseInt(moment().format('X')) + 28800; // GMT + 8 time zone

                        if (detail.type == 'poll') {
                            choice = res['請輸入投票選項，每個選項請用空格隔開：'].split(/\ /);
                            for (var i = 0; i < choice.length; i++) {
                                detail.option.push({ text: choice[i], count: 0, tickets: [] });
                            }
                        }
                        pollCase.addCase(controller, bot, detail);
                    }
                });
            }
            bot.startConversation(message, askTitle);
        }
    },

    // Command: '/vote case_id' ; 
    vote: function(controller, bot, message, case_id) {
        var quali_case = true;
        var case_type = '';

        // Handle the exception of poll case
        var check_case = function checkCase(callback) {
            controller.storage.teams.get(message.team_id, function(err, team) {
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

                        if ((parseInt(moment().format('X')) + 28800) > team.polling_case[i].details.due_date) {
                            sendVote('overDue');
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
                case 'overDue':
                    bot.replyPrivate(message, '此投票案已經過期。使用 `/result ' + case_id + '`指令查看結果');
                    break;
                default:
                    if (case_type == 'poll') {
                        pollCase.createOption(controller, case_id, message.team_id, message.user, function(data) {
                            bot.replyPrivate(message, data);
                        });
                    } else if (case_type == 'input_number') {
                        pollCase.askNumber(controller, bot, message, case_id, message.user, function(choice, unique_ticket) {
                            userCase.updateCase(controller, message.user, case_id, choice, unique_ticket);
                        });
                    }
                    break;
            }

        }
    },

    // Command: '/result case_id' ; Display the result of specific case
    result: function(controller, bot, message, case_id, data, plotly) {
        controller.storage.teams.get(message.team_id, function(err, team) {
            var polling_case = team.polling_case;
            for (var i = 0; i < polling_case.length; i++) {
                if (case_id == polling_case[i].case_id) {

                    data.attachments[0].title = '#' + case_id + '結果：' + polling_case[i].details.title;
                    data.attachments[0].text = polling_case[i].details.description;
                    data.attachments[1].title = '#' + case_id + ' 圖表';

                    // For type = poll
                    if (polling_case[i].details.type == 'poll') {

                        var visual_data = [{ x: [], y: [], type: 'bar' }];
                        var layout = { fileopt: 'overwrite', filename: moment().format('X') };
                        for (var j = 0; j < polling_case[i].details.option.length; j++) {
                            // For text display
                            data.attachments[0].fields.push({
                                title: polling_case[i].details.option[j].text,
                                value: polling_case[i].details.option[j].count + '票\n' + '已投入票卷: ' +
                                    polling_case[i].details.option[j].tickets,
                                short: true
                            });

                            visual_data[0].x.push(polling_case[i].details.option[j].text);
                            visual_data[0].y.push(polling_case[i].details.option[j].count);
                        }



                    } else if (polling_case[i].details.type == 'input_number') {

                        //For type = input_number
                        var sum = 0;
                        var length = polling_case[i].details.option.length;

                        var visual_data = [{ x: polling_case[i].details.option, type: 'histogram' }];
                        var layout = { fileopt: 'overwrite', filename: moment().format('X') };

                        data.attachments.push({
                            title: '詳細列表: 輸入數字 → 票卷號碼',
                            text: '',
                            color: '#F35A00'
                        });

                        for (var j = 0; j < length; j++) {
                            sum += polling_case[i].details.option[j];
                            data.attachments[2].text += polling_case[i].details.option[j] + '→' + polling_case[i].tickets[j] + '\n';
                        }

                        console.log("option list: " + polling_case[i].details.option);
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

                    plot_on_result(plotly, visual_data, layout, function(url) {
                        data.attachments[1].text = 'Click here to see! ' + url;
                        bot.replyPrivate(message, data);
                    });
                    break;
                }
            }
        });
    },

    // Command: '/unvote'; Display the case which user has joined, but hasn't vote yet.
    unvote: function(controller, bot, message, data) {
        controller.storage.users.get(message.user, function(err, user) {
            var unvote_case = [];

            for (var i in user.join_case) {
                if (user.join_case[i].done == false) {
                    unvote_case.push('#' + user.join_case[i].case_id + ' ');
                    //data.attachments[0].text.concat("#",user.join_case[i].case_id, ",");
                }
            }
            data.attachments[0].text += unvote_case.join();
            bot.replyPrivate(message, data);
        });
    },

    // Command: '/votehelp'
    help: function(bot, message) {
        var helptext = require('./helptext');
        bot.replyPrivate(message, helptext);
    }
}
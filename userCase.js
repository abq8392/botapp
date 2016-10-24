var Botkit = require('botkit');

module.exports = {

    // Get the list of group members
    getUserList: function(bot, callback) {
        bot.api.users.list({ token: bot.config.token }, function(err, res) {
            var users_list = [];
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
            callback(users_list);
        });
    },

    // Add case to user database
    addCase: function(controller, join_user, pass_case) {
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
    },

    // Record whether user vote or not, and his/her choice
    // Add unique ticket number
    updateCase: function(controller, join_user, pass_case, choice, unique_ticket) {
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

}
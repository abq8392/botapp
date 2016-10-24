var Botkit = require('botkit');

module.exports = function(bot, callback) {
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
        //callback && callback();
        callback(users_list);
    });
}
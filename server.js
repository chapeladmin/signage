var express = require('express');
var path = require('path');
var fs = require('fs');
var exec = require('child_process').exec;
var request = require('request');
var cheerio = require('cheerio');
var app = express();
var asset_dir = __dirname + '/assets/';

var config = require('./config.json');

var getTimeString = function() {
    var current_time = new Date();
    var hours = current_time.getHours();
    var minutes = current_time.getMinutes();
    var seconds = current_time.getSeconds();
    if (hours < 10) {
        hours = "0" + hours
    }
    if (minutes < 10) {
        minutes = "0" + minutes
    }
    if (seconds < 10) {
        seconds = "0" + seconds
    }
    return hours + ":" + minutes + ":" + seconds
};

var mkdirp = function(real_path, mode, callback) {
    process.nextTick(function() {
        var path_from_root = real_path.split(asset_dir)[1],
            path_array = path_from_root.split(path.sep),
            create_path = asset_dir;
        for(var i=0, path_count=path_array.length;i<path_count;i++) {
            segment = path_array[i];
            create_path = path.resolve(create_path, segment);
            if(!fs.existsSync(create_path)) {
                try {
                    fs.mkdirSync(create_path, mode);
                } catch(e) {
                    return callback(e);
                }
                console.log(getTimeString() + " " + 'mkdir: ' + create_path);
            }
        }
        callback(null);
    });
}

var updateAsset = function(url, asset_path, encoding) {
    var wget = 'wget -P ' + path.dirname(asset_path) + ' ' + url;
    var child = exec(wget, function(err, stdout, stderr) {
        if (err) throw err;
        else {
            console.log(getTimeString() + " " + 'writeAsset: ' + asset_path);
        }
    });
}

var writeAsset = function(url, asset_path, encoding) {
    var return_value = true;
    mkdirp(path.dirname(asset_path), 0750, function(err) {
        if(err) {
            throw err;
            return_value = false;
            return;
        }
        if(fs.existsSync(asset_path)) {
            var stats = fs.statSync(asset_path);
            var local_time = stats.mtime.getTime();
            var mtime_url = config.host + '/getmtime?file_path=' + url.split(config.host)[1];
            request(mtime_url, function(error, response, data) {
                var data = JSON.parse(data);
                if(!error) {
                    if(data.code == 200) {
                        if(local_time >= data.mtime) {
                            console.log(asset_path + " is already up to date");
                            return;
                        }
                    }
                }
                updateAsset(url, asset_path);
            });
        }
        else {
            updateAsset(url, asset_path);
        }
    });
    return return_value;
};

var synchronize = function() {
    var config_url = config.host + '/playerlookup?player_id=' + config.playerID;

    request(config_url, function(error, response, html) {
        if(!error) {
            var remote_config = JSON.parse(html);
            if(remote_config.code == 200) {
                var group = remote_config.group_name;
                var template = remote_config.template;
                var player_url = config.host + '/' + template + '?group_name=' + group;
                request(player_url, function(error, response, html) {
                    if(!error) {
                        var $ = cheerio.load(html);
                        $('script').each(function() {
                            var script_url = $(this).attr('src');
                            var script_path = template + '/' + script_url.split(template + '/')[1];
                            if(!writeAsset(script_url, asset_dir + script_path, 'utf8')) {
                                return;
                            }
                            $(this).attr('src', '/' + script_path);
                        });
                        $('link').each(function() {
                            var style_url = $(this).attr('href');
                            var style_path = template + '/' + style_url.split(template + '/')[1];
                            if(!writeAsset(style_url, asset_dir + style_path, 'utf8')) {
                                return;
                            }
                            $(this).attr('href', '/' + style_path);
                        });
                        $('img').each(function() {
                            var img_url = $(this).attr('src');
                            var basename = img_url.substring(img_url.lastIndexOf('/') + 1);
                            var img_path = 'images/' + basename;
                            if(!writeAsset(img_url, asset_dir + img_path, 'binary')) {
                                return;
                            }
                            $(this).attr('src', '/' + img_path);
                        });
                        $('video').each(function() {
                            var video_url = $(this).attr('src');
                            var basename = img_url.substring(img_url.lastIndexOf('/') + 1);
                            var video_path = 'videos/' + basename;
                            if(!writeAsset(video_url, asset_dir + video_path, 'binary')) {
                                return;
                            }
                            $(this).attr('src', '/' + video_path);
                        });
                        fs.writeFileSync(asset_dir + 'index.html', $.html());
                        console.log(getTimeString() + ' index.html written');
                    }
                    else {
                        console.log("couldn't load player template");
                    }
                });
            }
            else {
                console.log("player error code: " + remote_config.code);
            }
        }
        else {
            console.log("couldn't load player configuration from server");
        }
    });
};

synchronize();

app.get('/', function(req, res) {
    if(fs.existsSync(asset_dir + 'index.html')) {
        res.send(fs.readFileSync(asset_dir + 'index.html', {encoding: 'utf8'}));
    }
    else {
        res.send("Syncronization underway, please try again later.");
    }
});

app.use(express.static(asset_dir));

var timer = setInterval(synchronize, config.sleep_length * 1000);

app.listen('8080');

exports = module.exports = app;

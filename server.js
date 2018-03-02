const YAML = require('yamljs');
const fs = require('fs');
const Twitter = require('twitter');
const http = require('http');

const config = YAML.load('config.yml');
const client = new Twitter(config.twitter);
const keyword = config.filter || "#precure";

const app = http.createServer(handler);
const io = require('socket.io').listen(app);

var last_time = (new Date()).getTime();
var buffer = {tweets: [], images: []};
var myself = null;
var sockets = [];


/*
 * Get My IP
 */
http.get('http://httpbin.org/ip', (response) => {
    let data = '';
    response.on('data', chunk => { data += chunk; });
    response.on('end', () => {
        myself = JSON.parse(data).origin;
        console.log(`I am ${myself}`);
        console.log(`Listen on ${myself}:${config.port}`);
    });
});

function shuffle(str) {
    var chars = str.split('');
    for (var i = chars.length - 2; i >= 0; --i) {
        const j = i + 1;
        if (Math.random() < .3) {
            let tmp = chars[i];
            chars[i] = chars[j];
            chars[j] = tmp;
        }
    }
    return chars.join('');
}


function push_image(url) {
    buffer.images.push(url);
    if (buffer.images.length > 10) { buffer.images.shift(); }
    for (var i in sockets) { sockets[i].emit('image', url); }
}

function push_tweet(data) {
    var payload = {
        name: data.user.name,
        id: data.user.screen_name,
        image: data.user.profile_image_url.replace('_normal', '_400x400'),
        text: data.text
    };
    buffer.tweets.push(payload);
    if (buffer.tweets.length > 10) { buffer.tweets.shift(); }
    for (var i in sockets) { sockets[i].emit('tweet', payload); }
}


/*
 * Twitter REST
 */
function post(status) {
    console.log(`Post ${status}`);
    client.post('statuses/update', {
        status: status
    }, (error, tweet, response) => {
        if (error) console.warn(error);
    });
}

function delete_post(id) {
    client.post(`statuses/destroy/${id}.json`, {
        id : id
    }, function(){});
}


/*
 * Twitter Stream
 */
setInterval(() => {
    var now = (new Date()).getTime();
    var dmin = (now - last_time) / 1000 / 60;
    if (dmin > 10) process.exit();
}, 60);

client.stream('statuses/filter', {track: keyword}, stream => {
    stream.on('data', data => {
        last_time = (new Date()).getTime();
        if (!data || !data.user || !data.text) return;
        if (data.retweeted_status) return;  // when RT

        // buffering & emitting
        push_tweet(data);
        if (data.entities && data.entities.media) {
            for (var item of data.extended_entities.media) {
                push_image(item.media_url);
            }
        }

        // remove?
        if (data.user.screen_name === config.twitter.username &&
            (data.text[0] === '.' || data.text[0] === ':')) {
            const time = config.delete_sec;
            if (time > 0) {
                console.log(`Deleting ${data.id_str} after ${time} sec`);
                setTimeout(delete_post, time * 1000, data.id_str);
            }
        }
    });
});


/*
 * Web Server
 */
function handler(req, res) {
    fs.readFile("./index.html", (err, data) => {
        data = data.toString().replace(/@MYSELF/, `http://${myself}:${config.port}`);
        res.writeHead(200);
        res.end(data);
    });
};

/*
 * Web Socket
 */
io.sockets.on('connection', function (socket) {

    console.log('New socket');
    sockets.push(socket);
    for (var i in buffer.tweets) { socket.emit('tweet', buffer.tweets[i]); }
    for (var i in buffer.images) { socket.emit('image', buffer.images[i]); }
    if (sockets.length > 100) {
        sockets.shift();  // up to 100 users
        console.log('Unshift');
    }

    socket.on('post', function(data) {
        post('.' + shuffle(data.text) + ' #precure');
    });
});


// running server
app.listen(config.port, () => {
    console.log(`Listen on ${config.port}`);
});

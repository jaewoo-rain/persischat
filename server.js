const express = require('express');
const app = express();
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const { createServer } = require('http');
const { Server } = require('socket.io');
const server = createServer(app);
const io = new Server(server);

let db;
let chatMessage = {};
let deleteTime = 60;
const url = process.env.DB_URL;
new MongoClient(url).connect().then((client) => {
    console.log('DB 연결 성공');
    db = client.db('persischat'); // 파일이름
    server.listen(8080, () => {
        console.log('http://localhost:8080');
    });
}).catch((err) => {
    console.log(err);
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// 세션 설정
app.use(session({
    secret: 'secretKey', // 보안을 위한 세션 암호화 키
    resave: false,
    saveUninitialized: false,
}));

// passport 초기화
app.use(passport.initialize());
app.use(passport.session());

// passport local strategy 설정
passport.use(new LocalStrategy({
    usernameField: 'id', // 요청 body의 필드 이름
    passwordField: 'password',
    session: true
}, async (id, password, done) => {
    let user = await db.collection('user').findOne({ id: id });
    if (!user) {
        return done(null, false, { message: '존재하지 않는 아이디입니다.' });
    }
    let isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return done(null, false, { message: '비밀번호가 일치하지 않습니다.' });
    }
    return done(null, user);
}));

// // passport local strategy 설정
// passport.use(new LocalStrategy({
//     usernameField: 'id', // 요청 body의 필드 이름
//     passwordField: 'password',
//     session: true
// }, async (id, password, done) => {
//     try {
//         let user = await db.collection('user').findOne({ id: id });
//         if (!user) {
//             return done(null, false, { message: '존재하지 않는 아이디입니다.' });
//         }
//         // 비밀번호가 암호화되지 않았으므로, 단순 문자열 비교
//         if (password !== user.password) {
//             return done(null, false, { message: '비밀번호가 일치하지 않습니다.' });
//         }
//         return done(null, user);
//     } catch (error) {
//         return done(error);
//     }
// }));


// 세션에 저장할 사용자 정보 설정
passport.serializeUser((user, done) => {
    done(null, user.id);
});

// 세션에서 사용자 정보 복구
passport.deserializeUser(async (id, done) => {
    let user = await db.collection('user').findOne({ id: id });
    if (!user) return done(null, false);
    return done(null, user);
});

// 인증된 사용자만 접근 가능하게 하는 미들웨어
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/');
}

// 메인 페이지
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.get('/signup', (req, res) => {
    res.render('signup.ejs');
});


// 비밀번호 암호화 회원가입
app.post('/signup', async (req, res) => {
    const { id, name, password, passwordConfirm } = req.body;

    // 비밀번호 확인
    if (password !== passwordConfirm) {
        return res.status(400).send('비밀번호가 일치하지 않습니다.');
    }

    // 아이디 중복 확인
    let existingUser = await db.collection('user').findOne({ id: id });
    if (existingUser) {
        return res.status(400).send('이미 존재하는 아이디입니다.');
    }

    // 비밀번호 해시화
    const hashedPassword = await bcrypt.hash(password, 10);

    // 회원정보 저장 (해시된 비밀번호 저장)
    await db.collection('user').insertOne({
        id: id,
        name: name,
        password: hashedPassword // 암호화된 비밀번호 저장
    });

    // 자동으로 유저를 위한 채팅방 생성
    await db.collection('chatroom').insertOne({
        creatUserID: id,
        userID: [id],
        date: new Date()
    });

    res.redirect('/');
});


// 로그인 라우트
app.post('/login', passport.authenticate('local', {
    // successRedirect: `/list?id=${req.id}`,
    failureRedirect: '/',
    failureFlash: false

}), (req, res) => {
    res.redirect(`/list?id=${req.body.id}`)
});

// 로그아웃 라우트
app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        // 세션을 완전히 파기
        req.session.destroy((err) => {
            if (err) {
                return next(err);
            }
            // 세션 파기 후 메인 페이지로 리다이렉트
            res.redirect('/');
        });
    });
});

// // 리스트 페이지
// app.get('/list', isAuthenticated, async (req, res) => {
//     let chatroom = await db.collection('chatroom').find().toArray();
//     console.log(req.query.id)
//     if (req.query.id == 'admin') {
//         res.render('adminPage.ejs')
//     } else {
//         res.render('chatList.ejs', { userID: req.query.id, room: chatroom });

//     }
// });

// 리스트 페이지 라우트
app.get('/list', isAuthenticated, async (req, res) => {
    // 세션에서 로그인된 사용자 정보 가져오기
    let userID = req.user.id; // req.user는 로그인된 사용자 정보
    let chatroom = await db.collection('chatroom').find().toArray();

    // 로그인된 사용자의 정보만 사용하여 채팅방을 표시
    if (userID == 'admin') {
        res.redirect('/admin');
    } else {
        res.render('chatList.ejs', { userID: userID, room: chatroom });
    }
});



// 채팅방 입장 라우터
app.post('/room', async (req, res) => {
    let currentRoom = await db.collection('chatroom').findOne({ creatUserID: req.body.creatUserID });
    if (!currentRoom.userID.includes(req.body.userID)) {
        let user = currentRoom.userID;
        user.push(req.body.userID);
        await db.collection('chatroom').updateOne(
            { _id: currentRoom._id },
            { $set: { userID: user } }
        );
        currentRoom = await db.collection('chatroom').findOne({ userID: req.body.userID });
    }
    let roomID = currentRoom._id.toString();
    let preMessage = chatMessage[roomID];
    res.render('chatRoom.ejs', {
        room: currentRoom,
        userID: req.body.userID,
        chat: preMessage ? preMessage : [],
    });


});

// 랜덤 채팅방 입장 라우터
app.post('/room/:next', async (req, res) => {
    let currentRoom = await db.collection('chatroom').aggregate([
        { $match: { creatUserID: { $ne: req.body.creatUserID } } },
        { $sample: { size: 1 } }
    ]).toArray();
    currentRoom = currentRoom[0];
    let user = currentRoom.userID;
    user.push(req.body.userID);
    await db.collection('chatroom').updateOne(
        { _id: currentRoom._id },
        { $set: { userID: user } }
    );
    currentRoom = await db.collection('chatroom').findOne({ userID: req.body.userID });
    let roomID = currentRoom._id.toString();
    let preMessage = chatMessage[roomID];
    if (!preMessage) {
        preMessage = [];
    }
    res.render('chatRoom.ejs', {
        room: currentRoom,
        userID: req.body.userID,
        chat: preMessage
    });
});

// 관리자 페이지로 사용자 및 채팅룸 목록을 넘겨줍니다.
app.get('/admin', isAuthenticated, async (req, res) => {
    if (req.user.id !== 'admin') {
        return res.redirect('/');
    }

    try {
        const userPage = parseInt(req.query.userPage) || 1; // 사용자 페이지 번호, 기본값 1
        const roomPage = parseInt(req.query.roomPage) || 1; // 채팅방 페이지 번호, 기본값 1
        const limit = 5; // 페이지당 항목 수

        // 사용자 목록 가져오기 (페이지네이션)
        const skipUsers = (userPage - 1) * limit;
        const users = await db.collection('user')
            .find()
            .skip(skipUsers)
            .limit(limit)
            .toArray();
        const totalUsers = await db.collection('user').countDocuments();
        const totalUserPages = Math.ceil(totalUsers / limit); // 사용자 총 페이지 수

        // 채팅방 목록 가져오기 (페이지네이션)
        const skipRooms = (roomPage - 1) * limit;
        const rooms = await db.collection('chatroom')
            .find()
            .skip(skipRooms)
            .limit(limit)
            .toArray();
        const totalRooms = await db.collection('chatroom').countDocuments();
        const totalRoomPages = Math.ceil(totalRooms / limit); // 채팅방 총 페이지 수

        // 렌더링
        res.render('adminPage.ejs', {
            users,
            rooms,
            currentUserPage: userPage,
            totalUserPages,
            currentRoomPage: roomPage,
            totalRoomPages
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('데이터를 가져오는 데 실패했습니다.');
    }
});


// 사용자 삭제 API
app.delete('/admin/user/:id', isAuthenticated, async (req, res) => {
    if (req.user.id !== 'admin') {
        return res.status(403).json({ success: false, message: '권한이 없습니다.' });
    }

    try {
        await db.collection('user').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: '사용자 삭제 실패' });
    }
});

// 사용자 추가
app.post('/admin/user', isAuthenticated, async (req, res) => {
    if (req.user.id !== 'admin') {
        return res.status(403).json({ success: false, message: '권한이 없습니다.' });
    }

    try {
        const { id, name, password } = req.body;

        // 아이디 중복 확인
        let existingUser = await db.collection('user').findOne({ id });
        if (existingUser) {
            return res.status(400).json({ success: false, message: '이미 존재하는 아이디입니다.' });
        }

        // 비밀번호 해시화
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, 10);

        // 새로운 사용자 저장
        await db.collection('user').insertOne({
            id,
            name,
            password: hashedPassword, // 해시된 비밀번호 저장
        });

        // 사용자 생성자로 채팅방 자동 생성
        await db.collection('chatroom').insertOne({
            creatUserID: id,  // 새로운 사용자 ID를 채팅방 생성자로 설정
            userID: [id],     // 해당 채팅방의 참여자는 생성자 본인
            date: new Date()  // 생성 일자
        });

        res.json({ success: true, message: '사용자 및 채팅방이 성공적으로 생성되었습니다.' });
    } catch (err) {
        res.status(500).json({ success: false, message: '사용자 추가 및 채팅방 생성 실패' });
    }
});



// 채팅룸 삭제 API
app.delete('/admin/room/:id', isAuthenticated, async (req, res) => {
    if (req.user.id !== 'admin') {
        return res.status(403).json({ success: false, message: '권한이 없습니다.' });
    }

    try {
        await db.collection('chatroom').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: '채팅룸 삭제 실패' });
    }
});

app.post('/admin/room', isAuthenticated, async (req, res) => {
    if (req.user.id !== 'admin') {
        return res.status(403).json({ success: false, message: '권한이 없습니다.' });
    }

    try {
        const { creatUserID } = req.body;
        // 채팅방 생성
        await db.collection('chatroom').insertOne({
            creatUserID,
            userID: [creatUserID],
            date: new Date(),
        });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, message: '채팅방 추가 실패' });
    }
});

// 채팅방 정보 가져오기
app.get('/admin/room/:id', isAuthenticated, async (req, res) => {
    if (req.user.id !== 'admin') {
        return res.redirect('/');
    }

    try {
        const roomID = req.params.id;
        const page = parseInt(req.query.page) || 1; // 요청된 페이지 번호, 기본값은 1
        const limit = 10; // 페이지당 가져올 메시지 수
        const skip = (page - 1) * limit; // 건너뛸 메시지 수 계산

        // 채팅방 정보 가져오기
        const chatRoom = await db.collection('chatroom').findOne({ _id: new ObjectId(roomID) });

        // 현재 페이지에 맞는 메시지 가져오기
        const messages = await db.collection(roomID)
            .find() // 채팅 메시지 컬렉션에서
            .skip(skip) // 건너뛸 메시지 수
            .limit(limit) // 가져올 메시지 수 제한
            .toArray(); // 배열로 변환

        // 전체 메시지 수
        const totalMessages = await db.collection(roomID).countDocuments();
        const totalPages = Math.ceil(totalMessages / limit); // 전체 페이지 수 계산

        // 페이지 데이터 렌더링
        res.render('chatRoomData.ejs', {
            room: chatRoom, // 채팅방 정보
            messages, // 현재 페이지 메시지
            currentPage: page, // 현재 페이지 번호
            totalPages // 전체 페이지 수
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('채팅방 데이터를 가져오는 데 실패했습니다.');
    }
});




// 페이지 떠나기 라우터
app.post('/page-leave', async (req, res) => {
    await db.collection('chatroom').updateOne(
        { _id: new ObjectId(req.query.roomID) },
        { $pull: { userID: req.query.userID } }
    );
    res.sendStatus(200);
});

// 소켓 통신
io.on('connection', (socket) => {
    socket.on('ask-join', (roomID) => {
        socket.join(roomID);
        if (!chatMessage[roomID]) {
            chatMessage[roomID] = [];
        }
        room = io.sockets.adapter.rooms.get(roomID);
        io.to(roomID).emit('room-size', room.size);
    });

    socket.on('message', async (data) => {
        let currentTime = new Date();
        let textColor = data.textColor;
        let message = { userID: data.user, text: data.text, time: currentTime, textColor: data.textColor };
        chatMessage[data.roomID].push(message);
        await db.collection(data.roomID).insertOne({
            writer: data.user,
            message: data.text,
            time: currentTime,
            color: textColor
        });
        io.to(data.roomID).emit('msg', { message: data.text, user: data.user, textColor: data.textColor });

        setTimeout(async () => {
            chatMessage[data.roomID].shift();
            io.to(data.roomID).emit('delete-message', { message: data.text, user: data.user });
        }, 1000 * deleteTime);
    });

    socket.on('leave-page', (roomID) => {
        room = io.sockets.adapter.rooms.get(roomID);
        io.to(roomID).emit('room-size', room.size - 1);
    });
});

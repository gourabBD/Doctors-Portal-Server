const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET);


const port = process.env.PORT || 5000;

const app = express();

// middleware
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.m8joqcm.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

let verifyJWT=(req,res,next)=>{

 const authHeader=req.headers.authorization;
 console.log(authHeader)
 if(!authHeader){
    return res.status(401).send('Unauthorized access');
 }
 const  token=authHeader.split(' ')[1];
 
 jwt.verify(token, process.env.ACCESS_TOKEN, function(err,decoded){
    if(err){
        return res.status(403).send({message: 'Forbidden Aceess'})
    }
    req.decoded=decoded;
    next();
 })
}

async function run() {
    try {
        const appointmentOptionCollection = client.db('doctorsPortal').collection('appointmentOptions');
        const bookingsCollection = client.db('doctorsPortal').collection('bookings');
        const usersCollection = client.db('doctorsPortal').collection('users');
        const doctorsCollection = client.db('doctorsPortal').collection('doctors');
        const paymentsCollection = client.db('doctorsPortal').collection('payments');

        const verifyAdmin= async(req,res,next)=>{
            console.log('inside verifiedAdmin:',req.decoded.email)
            const decodedEmail = req.decoded.email;
    const query ={email: decodedEmail}
    const user=await usersCollection.findOne(query)
    if(user?.role !== 'admin'){
        return res.status(403).send({message: 'Forbidden Access'})
    }
            next();
        }

        // Use Aggregate to query multiple collection and then merge data
        app.get('/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            
            const query = {};
            const options = await appointmentOptionCollection.find(query).toArray();

            // get the bookings of the provided date
            const bookingQuery = { appointmentDate: date }
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();

            // code carefully :D
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name);
                
                const bookedSlots = optionBooked.map(book => book.slot);
                
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots;
              
            })
            res.send(options);
        });

       

        /***
         * API Naming Convention 
         * app.get('/bookings')
         * app.get('/bookings/:id')
         * app.post('/bookings')
         * app.patch('/bookings/:id')
         * app.delete('/bookings/:id')
        */

app.get('/appointmentSpecialty',async(req,res)=>{
    const query={}
    const result=await appointmentOptionCollection.find(query).project({name:1}).toArray();
    res.send(result)
})

 app.post('/bookings',async(req,res)=>{
    const booking= req.body;
    const query={
        appointmentDate: booking.appointmentDate,
        treatment: booking.treatment,
        email: booking.email
    }
    const alreadyBooked= await bookingsCollection.find(query).toArray()
    if(alreadyBooked.length){
        const message=`You already have a booking on ${booking.appointmentDate}`
        return res.send({acknowledged:false, message})
    }
    const result= await bookingsCollection.insertOne(booking);
    res.send(result)
 })
       

 app.get('/bookings',verifyJWT, async (req, res) => {
    const email=req.query.email;
    console.log(email)
    const decodedEmail= req.decoded.email;
    // console.log(decodedEmail)
    if(email !== decodedEmail){
        return res.status(403).send({ message: 'Forbidden Access'});
    }
    const query = {email:email};
    const bookings = await bookingsCollection.find(query).toArray();
    res.send(bookings);
})
//seperating data by id for payment system
app.get('/bookings/:id',async(req,res)=>{
    const id= req.params.id;
    const query={_id: ObjectId(id)};
    const booking= await bookingsCollection.findOne(query)
    res.send(booking)
})


app.post("/create-payment-intent", async (req, res) => {
    const booking = req.body;
    const price=booking.price 
    const amount=price*100
  
    // Create a PaymentIntent with the order amount and currency
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: "usd",
      amount: amount,
      payment_method_types: [
        "card"
      ],
     
    });
  
    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  });

  app.post('/payments',async(req,res)=>{
    const payment=req.body
    const result=await paymentsCollection.insertOne(payment)
    const id=payment.bookingId
    const filter={_id: ObjectId(id)}
    const updatedDoc={
        $set: {
            paid:true,
            transactionId: payment.transactionId
        }
    }
    const updateResult= await bookingsCollection.updateOne(filter,updatedDoc)
    res.send(result)
  })

app.get('/jwt',async(req,res)=>{
    const email=req.query.email;
    const query ={email: email};
    const user=await usersCollection.findOne(query);
    if(user){
         const token=jwt.sign({email},process.env.ACCESS_TOKEN,{expiresIn:'1h'}) 
         return res.send({accessToken: token})
    }
    res.status(403).send({accessToken: ''})
    
})
app.get('/users', async(req,res)=>{
    const query ={};
    const users=await usersCollection.find(query).toArray();
    res.send(users)
})

app.get('/users/admin/:email', async(req,res)=>{
    const email=req.params.email;
    const query= {email}
    const user =await usersCollection.findOne(query)
    res.send({isAdmin: user?.role === 'admin' })
})

 app.post('/users',async(req,res)=>{
    const user=req.body;
    const result= await usersCollection.insertOne(user)
    res.send(result)
 })
 app.put('/users/admin/:id', verifyJWT,verifyAdmin, async(req,res)=>{
   
    const id=req.params.id;
    const filter ={_id: ObjectId(id)}
    const options={upsert: true}
    const updateDoc={
        $set: {
            role: 'admin'
        }
    }
    const result=await usersCollection.updateOne(filter,updateDoc,options)
    res.send(result)
 })

//temporary to update price field on appointment options
// app.get('/addPrice',async(req,res)=>{
//     const filter={}
//     const options={upsert:true}
//     const updateDoc={
//         $set: {
//             price: 99
//         }
//     }
//     const result= await appointmentOptionCollection.updateMany(filter,updateDoc,options);
//     res.send(result);
// })

 app.get('/doctors',verifyJWT,verifyAdmin, async(req,res)=>{
    const query ={}
    const doctors= await doctorsCollection.find(query).toArray()
    res.send(doctors)
 })
 app.delete('/doctors/:id',verifyJWT,verifyAdmin,async(req,res)=>{
    const id=req.params.id;
    const filter={_id:ObjectId(id)}
    const result= await doctorsCollection.deleteOne(filter)
    res.send(result)
 })

 app.post('/doctors',verifyJWT,verifyAdmin ,async(req,res)=>{
    const doctor =req.body;
    const result=await doctorsCollection.insertOne(doctor);
    res.send(result)
 })

    }
    finally {

    }
}
run().catch(console.dir);

app.get('/', async (req, res) => {
    res.send('doctors portal server is running');
})

app.listen(port, () => console.log(`Doctors portal running on ${port}`))
/**
 * Hindu names from every region of India, plus the Nepali/Gorkha and
 * Indo-Caribbean communities. Surnames span Brahmin, Kshatriya/Rajput, Vaishya,
 * Kayastha, Khatri, Jat, OBC, Dalit and Adivasi communities, and occupational names.
 *
 * Any edit here changes which name an id maps to — see ../name-generator.service.ts.
 */

// prettier-ignore
export const firstNames: readonly string[] = [
  // North India
  'Aaradhya', 'Aarav', 'Aarohi', 'Abhishek', 'Aditi', 'Aditya', 'Ajay', 'Akanksha', 'Akash',
  'Akhilesh', 'Alka', 'Alok', 'Aman', 'Amit', 'Amitabh', 'Anand', 'Anika', 'Aniket', 'Anil',
  'Anita', 'Anjali', 'Ankit', 'Ankita', 'Ankur', 'Anshul', 'Anurag', 'Anushka', 'Aparna', 'Archana',
  'Arjun', 'Arpit', 'Arun', 'Asha', 'Ashish', 'Ashok', 'Ashutosh', 'Atul', 'Avinash', 'Avni',
  'Ayush', 'Babita', 'Bharat', 'Bhavna', 'Brijesh', 'Chandan', 'Chitra', 'Deepak', 'Deepika',
  'Devansh', 'Devendra', 'Dheeraj', 'Dhruv', 'Dinesh', 'Divya', 'Diya', 'Ekta', 'Gagan', 'Garima',
  'Gaurav', 'Gauri', 'Geeta', 'Girish', 'Govind', 'Harsh', 'Hemant', 'Himanshu', 'Ira', 'Isha',
  'Ishaan', 'Ishani', 'Jatin', 'Jitendra', 'Juhi', 'Jyoti', 'Kabir', 'Kajal', 'Kamal', 'Kamini',
  'Kanchan', 'Kapil', 'Karan', 'Kavita', 'Khushi', 'Kiara', 'Kishore', 'Komal', 'Krishna', 'Kriti',
  'Kunal', 'Kusum', 'Lalit', 'Lata', 'Lokesh', 'Madhav', 'Madhuri', 'Mamta', 'Manish', 'Manisha',
  'Manoj', 'Mayank', 'Megha', 'Mohit', 'Monika', 'Mukesh', 'Myra', 'Nakul', 'Namrata', 'Narendra',
  'Naveen', 'Navya', 'Neelam', 'Neeraj', 'Neha', 'Nidhi', 'Nikhil', 'Nisha', 'Nishant', 'Nitin',
  'Pallavi', 'Pankaj', 'Pawan', 'Piyush', 'Pooja', 'Poonam', 'Pradeep', 'Prakash', 'Pramod',
  'Pranav', 'Prashant', 'Preeti', 'Priya', 'Priyanka', 'Puneet', 'Pushpa', 'Rachna', 'Radha',
  'Rahul', 'Rajat', 'Rajesh', 'Rakesh', 'Ramesh', 'Rashmi', 'Ravi', 'Rekha', 'Renu', 'Ritesh',
  'Ritu', 'Riya', 'Rohan', 'Rohit', 'Saanvi', 'Sachin', 'Sahil', 'Sakshi', 'Sandeep', 'Sanjay',
  'Sapna', 'Sarita', 'Saurabh', 'Savita', 'Seema', 'Shalini', 'Shikha', 'Shilpa', 'Shivam',
  'Shobha', 'Shreya', 'Shubham', 'Shweta', 'Siddharth', 'Sneha', 'Sonia', 'Suman', 'Sumit', 'Sunil',
  'Sunita', 'Suresh', 'Sushila', 'Swati', 'Tanvi', 'Tanya', 'Tara', 'Tarun', 'Tushar', 'Uday',
  'Umesh', 'Usha', 'Vandana', 'Vanshika', 'Varun', 'Vidya', 'Vihaan', 'Vikas', 'Vikram', 'Vinay',
  'Vinod', 'Vishal', 'Vivek', 'Yash', 'Yogesh',
  // South India
  'Abirami', 'Aishwarya', 'Ajith', 'Akhil', 'Ambika', 'Amrutha', 'Anbu', 'Anirudh', 'Anoop',
  'Anupama', 'Anusha', 'Arul', 'Arvind', 'Ashwathi', 'Ashwin', 'Balaji', 'Basavaraj', 'Bharathi',
  'Bhargavi', 'Bhaskar', 'Bhavani', 'Bhuvana', 'Biju', 'Bindu', 'Chaitanya', 'Chandrasekhar',
  'Chandrika', 'Chiranjeevi', 'Darshan', 'Deepa', 'Devika', 'Dhanush', 'Dhanya', 'Dileep',
  'Dinakaran', 'Durga', 'Ganesh', 'Gayathri', 'Gokul', 'Gopakumar', 'Gopal', 'Gopika', 'Gowtham',
  'Hari', 'Harikrishnan', 'Harini', 'Harish', 'Haritha', 'Hema', 'Ilango', 'Indira', 'Jagadish',
  'Janani', 'Jayakumar', 'Jayan', 'Jayanthi', 'Kalyani', 'Kamala', 'Kanimozhi', 'Kannan', 'Karthik',
  'Kathir', 'Kavya', 'Keerthi', 'Kiran', 'Kokila', 'Kumaran', 'Lakshmi', 'Lavanya', 'Mahalakshmi',
  'Mahesh', 'Malini', 'Mani', 'Manikandan', 'Manjula', 'Manjunath', 'Meenakshi', 'Meera', 'Mounika',
  'Murali', 'Muthu', 'Nagaraj', 'Nagarjuna', 'Nandini', 'Narayan', 'Nayana', 'Nithya', 'Padma',
  'Parvathi', 'Pavithra', 'Prabhakar', 'Prajwal', 'Pranathi', 'Pranesh', 'Praveen', 'Priyadarshini',
  'Radhika', 'Raghav', 'Raghavendra', 'Rajeev', 'Rajendran', 'Rajeswari', 'Rajkumar', 'Ramakrishna',
  'Ramya', 'Revathi', 'Rohini', 'Sahithi', 'Sai', 'Sajeev', 'Sakthi', 'Sandhya', 'Sangeetha',
  'Santhosh', 'Sarala', 'Saranya', 'Saravanan', 'Sathish', 'Sekar', 'Selvam', 'Selvi', 'Senthil',
  'Shankar', 'Shanthi', 'Sharada', 'Shivaraj', 'Shobana', 'Shyam', 'Siva', 'Sowmya', 'Sravani',
  'Sreeja', 'Sreejith', 'Sreekumar', 'Sreelakshmi', 'Sridhar', 'Srikanth', 'Srinivas', 'Srividya',
  'Sruthi', 'Sudeep', 'Sudha', 'Sudheer', 'Suganya', 'Sunanda', 'Sundar', 'Surya', 'Swarna',
  'Tejaswini', 'Thenmozhi', 'Thiru', 'Tulasi', 'Uma', 'Unni', 'Upendra', 'Vaishnavi', 'Vamsi',
  'Vani', 'Vasanth', 'Vasanthi', 'Vasudha', 'Veena', 'Velu', 'Venkat', 'Venu', 'Vignesh', 'Vijay',
  'Vineeth', 'Yamini', 'Yuvan',
  // East & Northeast India
  'Abhijit', 'Amartya', 'Ananya', 'Anirban', 'Anupam', 'Aparajita', 'Arindam', 'Arnab', 'Arpita',
  'Barnali', 'Bembem', 'Bhupen', 'Bibhuti', 'Bipasha', 'Biswajit', 'Bitopan', 'Chandrima', 'Chaoba',
  'Chinmay', 'Debabrata', 'Debashish', 'Debjani', 'Debolina', 'Dhrubajyoti', 'Dipankar', 'Hirak',
  'Hiranya', 'Ibomcha', 'Indranil', 'Ishita', 'Itishree', 'Jagannath', 'Janaki', 'Jayashree',
  'Jishnu', 'Jonali', 'Joydeep', 'Jyotirmayee', 'Kangkana', 'Kaushik', 'Koel', 'Kundan', 'Lipika',
  'Madhumita', 'Mainak', 'Maithili', 'Manas', 'Mitali', 'Mithilesh', 'Moumita', 'Mousumi',
  'Nabanita', 'Nilakshi', 'Oindrila', 'Papori', 'Paromita', 'Partha', 'Payel', 'Poulami',
  'Pradyumna', 'Pragyan', 'Pranjal', 'Pratik', 'Pritam', 'Priyambada', 'Prosenjit', 'Rajarshi',
  'Ranvijay', 'Rasmita', 'Rituparna', 'Rupa', 'Rupam', 'Rupjyoti', 'Sabyasachi', 'Sambit',
  'Sanatombi', 'Sanchita', 'Sanghamitra', 'Saroj', 'Sasmita', 'Satyajit', 'Sharmila', 'Shatrughan',
  'Shubhendu', 'Sita', 'Smruti', 'Sohini', 'Soumya', 'Sourav', 'Srabanti', 'Sreemoyee', 'Subhash',
  'Subhashree', 'Subrat', 'Sudeshna', 'Sudipto', 'Sushant', 'Swagatika', 'Tanushree', 'Tapas',
  'Tathagata', 'Thoibi', 'Tomba', 'Ujjwal', 'Urmila', 'Vaidehi',
  // West India
  'Aarti', 'Abhay', 'Ajinkya', 'Amol', 'Anagha', 'Ashwini', 'Atharva', 'Bhairon', 'Bhakti',
  'Bhanwar', 'Bhanwari', 'Bhavesh', 'Bhavik', 'Bhumi', 'Chandrakala', 'Chandru', 'Chetan', 'Chirag',
  'Damodar', 'Dayal', 'Dhara', 'Dhaval', 'Dhwani', 'Gajanan', 'Gargi', 'Gaurang', 'Girdhari',
  'Gobind', 'Hardik', 'Harshal', 'Hemangi', 'Hemlata', 'Hetal', 'Hitesh', 'Indu', 'Jaikishan',
  'Janhavi', 'Jaydev', 'Jayesh', 'Jignesh', 'Kailash', 'Kalpesh', 'Kedar', 'Kesar', 'Ketaki',
  'Ketan', 'Kinjal', 'Kishin', 'Lakshman', 'Leela', 'Madhavi', 'Mahendra', 'Manasi', 'Mandar',
  'Mihir', 'Mitesh', 'Mohini', 'Mrunal', 'Nikita', 'Nilesh', 'Ninad', 'Nirali', 'Nirav', 'Omkar',
  'Padmini', 'Parag', 'Pradnya', 'Prajakta', 'Pratap', 'Prathamesh', 'Prem', 'Pundalik', 'Pushkar',
  'Rasika', 'Ratan', 'Riddhi', 'Rukmini', 'Rushikesh', 'Rutuja', 'Sagar', 'Sanket', 'Sarang',
  'Savitri', 'Sayali', 'Shalaka', 'Shantanu', 'Shraddha', 'Shripad', 'Siddhesh', 'Sonal', 'Supriya',
  'Swapnil', 'Tanmay', 'Tejal', 'Tejas', 'Ummed', 'Urmi', 'Vaibhav', 'Viraj', 'Vishnu', 'Vrushali',
  'Yatin',
  // Nepal, Kashmir & the Himalaya
  'Anish', 'Arundhati', 'Badri', 'Bansi', 'Bhagirath', 'Bhim', 'Bibek', 'Bimala', 'Bishal', 'Ganga',
  'Himani', 'Kalpana', 'Prabin', 'Pratibha', 'Rabin', 'Roshan', 'Sabin', 'Sharika', 'Sujan',
  'Sushma', 'Triloki', 'Uttara',
];

// prettier-ignore
export const lastNames: readonly string[] = [
  // Brahmin
  'Acharya', 'Agnihotri', 'Awasthi', 'Bajpai', 'Bhardwaj', 'Bhargava', 'Bhatt', 'Chaturvedi',
  'Dixit', 'Dubey', 'Dwivedi', 'Gaur', 'Gautam', 'Jha', 'Joshi', 'Mishra', 'Ojha', 'Pandey',
  'Parashar', 'Pathak', 'Purohit', 'Saraswat', 'Sharma', 'Shastri', 'Shukla', 'Tiwari', 'Tripathi',
  'Trivedi', 'Upadhyay', 'Vyas',
  // Uttarakhand, Himachal & Jammu
  'Bahuguna', 'Bisht', 'Dhami', 'Dobhal', 'Dogra', 'Guleria', 'Jamwal', 'Kandpal', 'Katoch',
  'Manhas', 'Nautiyal', 'Negi', 'Pant', 'Pathania', 'Rautela', 'Rawat', 'Thapliyal', 'Uniyal',
  // Rajput
  'Baghel', 'Bhadoria', 'Bhati', 'Bundela', 'Chandel', 'Chauhan', 'Chudasama', 'Jadeja', 'Jhala',
  'Kachhwaha', 'Panwar', 'Parmar', 'Raghuvanshi', 'Rajput', 'Rana', 'Rathore', 'Sengar',
  'Shekhawat', 'Sisodia', 'Solanki', 'Suryavanshi', 'Thakur', 'Tomar', 'Vaghela',
  // Bihar
  'Bhagat', 'Keshri', 'Kumar', 'Rai', 'Ranjan', 'Shahi',
  // Vaishya & Marwari
  'Agarwal', 'Bajaj', 'Bansal', 'Birla', 'Dalmia', 'Garg', 'Goel', 'Goenka', 'Gupta', 'Jalan',
  'Jhunjhunwala', 'Jindal', 'Kedia', 'Kejriwal', 'Khaitan', 'Khandelwal', 'Lohia', 'Mahajan',
  'Maheshwari', 'Mittal', 'Poddar', 'Ruia', 'Saraf', 'Singhal', 'Singhania', 'Somani', 'Varshney',
  // Kayastha
  'Asthana', 'Bakshi', 'Bhatnagar', 'Chitnis', 'Gupte', 'Kanungo', 'Karnik', 'Khare', 'Mathur',
  'Nigam', 'Prasad', 'Sahay', 'Saxena', 'Sinha', 'Srivastava', 'Verma',
  // Khatri, Arora & Sindhi
  'Advani', 'Ahuja', 'Arora', 'Batra', 'Bhatia', 'Chadha', 'Chawla', 'Chopra', 'Dhawan', 'Gidwani',
  'Grover', 'Gulati', 'Hinduja', 'Kalra', 'Kapoor', 'Khanna', 'Khosla', 'Khurana', 'Kohli',
  'Kripalani', 'Lalwani', 'Luthra', 'Malhotra', 'Mehra', 'Mehrotra', 'Mirchandani', 'Motwani',
  'Narang', 'Oberoi', 'Puri', 'Ramchandani', 'Sabharwal', 'Sachdeva', 'Sahni', 'Sethi', 'Sippy',
  'Sood', 'Suri', 'Talwar', 'Tandon', 'Taneja', 'Vaswani', 'Wadhwa',
  // Jat & Gurjar
  'Ahlawat', 'Bainsla', 'Beniwal', 'Chahar', 'Chaudhary', 'Dahiya', 'Godara', 'Hooda', 'Jakhar',
  'Kasana', 'Nagar', 'Phogat', 'Punia', 'Rathi', 'Sangwan', 'Sehrawat', 'Tevatia',
  // OBC, agrarian & artisan communities
  'Ahir', 'Barnwal', 'Chaurasia', 'Dhiman', 'Gangwar', 'Gurjar', 'Jaiswal', 'Jangid', 'Kashyap',
  'Kesarwani', 'Kewat', 'Kumawat', 'Kurmi', 'Kushwaha', 'Lodhi', 'Lohar', 'Mali', 'Mallah',
  'Maurya', 'Nishad', 'Pal', 'Prajapati', 'Rastogi', 'Sahu', 'Saini', 'Sonar', 'Soni', 'Suthar',
  'Swarnkar', 'Tamrakar', 'Vishwakarma', 'Yadav',
  // Dalit communities
  'Ahirwar', 'Bairwa', 'Bansode', 'Bhalerao', 'Bharti', 'Gedam', 'Ingle', 'Jatav', 'Kamble',
  'Kanojia', 'Kharat', 'Khatik', 'Khobragade', 'Meghwal', 'Meshram', 'Pasi', 'Paswan', 'Rajak',
  'Ram', 'Ramteke', 'Sonkar', 'Valmiki', 'Waghmare', 'Wankhede',
  // Adivasi communities
  'Bhil', 'Bhuria', 'Bodra', 'Dhurwe', 'Gamit', 'Gond', 'Hansda', 'Hembrom', 'Kisku', 'Mahato',
  'Majhi', 'Marandi', 'Meena', 'Munda', 'Murmu', 'Netam', 'Oraon', 'Purty', 'Soren', 'Tudu',
  'Uikey', 'Vasava',
  // Maharashtra
  'Agashe', 'Apte', 'Bapat', 'Bhave', 'Bhide', 'Bhoir', 'Bhosale', 'Chavan', 'Deshmukh',
  'Deshpande', 'Gadgil', 'Gaikwad', 'Ghorpade', 'Godbole', 'Gokhale', 'Holkar', 'Inamdar', 'Jadhav',
  'Kadam', 'Kale', 'Karve', 'Kelkar', 'Kher', 'Kulkarni', 'Mane', 'Mhatre', 'Mohite', 'More',
  'Naik', 'Nikam', 'Nimbalkar', 'Patil', 'Patwardhan', 'Pawar', 'Phadke', 'Ranade', 'Salunkhe',
  'Sathe', 'Sawant', 'Shimpi', 'Shinde', 'Tandel', 'Thorat', 'Tilak', 'Wagh',
  // Konkan & Goa
  'Gaitonde', 'Kamat', 'Kini', 'Mallya', 'Nadkarni', 'Pai', 'Prabhu', 'Sardesai', 'Shenoy',
  // Gujarat
  'Amin', 'Barot', 'Bhanushali', 'Bhavsar', 'Brahmbhatt', 'Chavda', 'Chokshi', 'Darji', 'Dave',
  'Desai', 'Dholakia', 'Gadhvi', 'Gajjar', 'Gandhi', 'Kapadia', 'Kotecha', 'Lakhani', 'Majithia',
  'Makwana', 'Mehta', 'Modi', 'Nanavati', 'Panchal', 'Pandya', 'Parekh', 'Patel', 'Rabari', 'Raval',
  'Sheth', 'Thakkar', 'Vankar',
  // Bengal
  'Adhikari', 'Bagchi', 'Banerjee', 'Barman', 'Basu', 'Bhattacharya', 'Bhowmick', 'Biswas', 'Bose',
  'Chakraborty', 'Chatterjee', 'Das', 'Dasgupta', 'Deb', 'Debnath', 'Dey', 'Dhar', 'Dutta',
  'Ganguly', 'Ghosh', 'Goswami', 'Guha', 'Haldar', 'Jana', 'Karmakar', 'Kundu', 'Lahiri', 'Maitra',
  'Maity', 'Majumdar', 'Mallick', 'Mitra', 'Mondal', 'Mukherjee', 'Nag', 'Patra', 'Pramanik', 'Roy',
  'Saha', 'Samanta', 'Sanyal', 'Sarkar', 'Sen', 'Sengupta',
  // Odisha
  'Behera', 'Biswal', 'Dash', 'Jena', 'Kar', 'Mohanty', 'Mohapatra', 'Panda', 'Parida', 'Patnaik',
  'Pradhan', 'Rath', 'Rout', 'Routray', 'Samal', 'Satapathy', 'Senapati', 'Swain',
  // Assam, Manipur & Tripura
  'Baruah', 'Basumatary', 'Bora', 'Borthakur', 'Brahma', 'Buragohain', 'Debbarma', 'Deka', 'Gogoi',
  'Gohain', 'Hazarika', 'Jamatia', 'Kalita', 'Konwar', 'Laishram', 'Mahanta', 'Medhi', 'Narzary',
  'Neog', 'Ningthoujam', 'Oinam', 'Phukan', 'Rabha', 'Rajkhowa', 'Reang', 'Saikia', 'Talukdar',
  'Thokchom', 'Wahengbam', 'Yumnam',
  // Tamil Nadu
  'Annamalai', 'Arumugam', 'Balasubramanian', 'Chettiar', 'Chidambaram', 'Ganesan', 'Gounder',
  'Iyengar', 'Iyer', 'Jayaraman', 'Kandasamy', 'Krishnan', 'Kumaraswamy', 'Mudaliar', 'Murugan',
  'Muthusamy', 'Nadar', 'Naicker', 'Natarajan', 'Padayachi', 'Palaniappan', 'Pandian', 'Pillai',
  'Raghavan', 'Rajagopal', 'Ramalingam', 'Ramanathan', 'Ramasamy', 'Reddiar', 'Servai', 'Shanmugam',
  'Srinivasan', 'Subramanian', 'Sundaram', 'Swaminathan', 'Thangaraj', 'Thevar', 'Udayar',
  'Vanniyar', 'Venkataraman',
  // Andhra Pradesh & Telangana
  'Achari', 'Akkineni', 'Allu', 'Bollineni', 'Chowdary', 'Daggubati', 'Dasari', 'Gadde', 'Goud',
  'Katragadda', 'Kolli', 'Kondapalli', 'Konidela', 'Mudiraj', 'Murthy', 'Naidu', 'Nallapati',
  'Nandamuri', 'Peddi', 'Penumatsa', 'Raju', 'Rao', 'Rayudu', 'Reddy', 'Sastry', 'Sunkara',
  'Talluri', 'Uppalapati', 'Vemula', 'Yarlagadda',
  // Karnataka & Kodagu
  'Adiga', 'Alva', 'Angadi', 'Ballal', 'Bangera', 'Biradar', 'Bopanna', 'Cariappa', 'Ganapathy',
  'Gowda', 'Hegde', 'Hiremath', 'Holla', 'Hosamani', 'Jois', 'Karanth', 'Kotian', 'Kunder',
  'Muthanna', 'Poojary', 'Poovaiah', 'Salian', 'Shettar', 'Shetty', 'Suvarna', 'Swamy', 'Thimmaiah',
  'Urs',
  // Kerala
  'Asan', 'Kaimal', 'Kartha', 'Kurup', 'Mannadiar', 'Marar', 'Menon', 'Nair', 'Nambiar', 'Nambisan',
  'Namboodiri', 'Nedungadi', 'Panicker', 'Pisharody', 'Poduval', 'Thampi', 'Unnithan', 'Warrier',
  // Nepali & Gorkha
  'Basnet', 'Bhattarai', 'Chhetri', 'Dahal', 'Dhakal', 'Ghimire', 'Karki', 'Khadka', 'Khatri',
  'Koirala', 'Limbu', 'Magar', 'Maharjan', 'Pokharel', 'Poudel', 'Shrestha', 'Subba', 'Thapa',
  // Kashmiri Pandit
  'Haksar', 'Handoo', 'Kaul', 'Pandita', 'Raina', 'Razdan', 'Sapru', 'Tickoo', 'Wanchoo', 'Zutshi',
  // Indo-Caribbean
  'Maharaj', 'Persaud', 'Ramkissoon', 'Seepersad',
  // Occupational
  'Daftary', 'Dalal', 'Fadnavis', 'Halwai', 'Havaldar', 'Jamadar', 'Khazanchi', 'Lokhande',
  'Munshi', 'Patwari', 'Potdar', 'Sonawane', 'Subedar', 'Tamboli', 'Vaidya', 'Zamindar',
];

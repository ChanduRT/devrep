from flask import Flask

app = Flask(__name__)

@app.route("/")
def home():
    return "It works!"

if __name__ == "__main__":
    print(">>> Flask App is starting...")
    app.run(debug=True)

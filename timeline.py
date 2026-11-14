
high=[]
medium=[]
low=[]





for item in convert:
    if item["priority"] == "high":
        high.append(item)
    elif item["priority"] == "medium":
        medium.append(item)
    else:
        low.append(item)

full_list = high + medium + low
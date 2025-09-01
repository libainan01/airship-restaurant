extends AirshipItemDataBase
class_name Dish

#region Dish属性
var price:float
var process:float
@export var picture:Image

func _init(new_price:float,new_process:float,new_picture:Image,new_name:StringName = "defaut_dish",new_size:int = 1) -> void:
	price = new_price
	process = new_process
	picture = new_picture
	name = new_name
	size = new_size

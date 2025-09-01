class_name Cable
extends PathFollow2D
@onready var cable_car_class = preload("res://Blueprints/AirshipBuilding/Cable_Car/cable_car.tscn")

func install_cable_car ()->Cable_car:
	var _cable_car = cable_car_class.instantiate() as Cable_car
	_cable_car._init_cable_car(self)
	add_child(_cable_car)
	return _cable_car
